import { stmt } from '../cache.js';
import { createLogger } from '../utils/logger.js';
import { composeFragments } from './fragment-loader.js';
import { buildEntityCatalogVariable, loadEntityCatalog } from './entity-catalog.js';
import { applyHeuristic } from './examples-heuristics/index.js';

const logger = createLogger('prompt-templates');

const VALID_MODES = new Set([
  'narrative',
  'graph-known',
  'graph-discovery',
  'graph-discovered-only',
  'narrative-graph-known',
  'narrative-graph-discovery',
  'narrative-graph-discovered-only',
]);

/**
 * Load a prompt template row from the database by name.
 * @param {object} db
 * @param {string} name
 * @returns {object|undefined}
 */
export function getTemplateByName(db, name) {
  return stmt(db, 'SELECT * FROM prompt_templates WHERE pt_name = ?').get(name);
}

/**
 * Compose a prompt from a template row and runtime variables.
 *
 * @param {object} template - prompt_templates row.
 * @param {Record<string, string>} variables - Map of {{ARCHITXT_*}} variable names to values.
 * @returns {{prompt: string, mode: string}}
 * @throws {Error} If a required variable is missing or if the composed prompt would be empty.
 */
export function composePrompt(template, variables = {}) {
  if (!template) {
    throw new Error('Template is required');
  }
  if (!VALID_MODES.has(template.pt_mode)) {
    throw new Error(`Invalid template mode: ${template.pt_mode}`);
  }

  const required = JSON.parse(template.pt_variables || '[]');
  const missing = required.filter((key) => {
    const value = variables[key];
    return value === undefined || value === null || (typeof value === 'string' && value.trim() === '');
  });
  if (missing.length > 0) {
    throw new Error(`Missing required variables for template ${template.pt_name}: ${missing.join(', ')}`);
  }

  const fragments = JSON.parse(template.pt_fragments || '[]');
  const fragmentText = composeFragments(fragments);
  const body = template.pt_body || '';
  const composed = fragmentText ? `${fragmentText}\n\n${body}` : body;
  if (composed.trim() === '') {
    throw new Error(`Composed prompt for template ${template.pt_name} is empty`);
  }

  // Substitute variables.
  let prompt = composed;
  for (const [key, value] of Object.entries(variables)) {
    if (typeof value !== 'string') continue;
    const pattern = new RegExp(`\\{\\{${key}\\}\\}`, 'g');
    prompt = prompt.replace(pattern, value);
  }

  // Strip optional (non-required) ARCHITXT placeholders that were not provided.
  // Required variables are validated above; this lets templates include optional
  // variables such as ARCHITXT_CORPUS without forcing every caller to supply them.
  const requiredSet = new Set(required);
  const corpusRequired = requiredSet.has('ARCHITXT_CORPUS');
  const corpusProvided = Object.prototype.hasOwnProperty.call(variables, 'ARCHITXT_CORPUS') &&
    typeof variables.ARCHITXT_CORPUS === 'string' &&
    variables.ARCHITXT_CORPUS.trim() !== '';

  // If ARCHITXT_CORPUS is optional and not supplied, remove the entire source
  // material section so the heading doesn't dangle at the end of the prompt.
  if (!corpusRequired && !corpusProvided) {
    prompt = prompt.replace(
      /\n{0,2}## Source material\s*\n\s*\{\{ARCHITXT_CORPUS\}\}\s*\n{0,2}/i,
      '\n'
    );
  }

  prompt = prompt.replace(/\\{\\{ARCHITXT_[A-Z_]+\\}\\}/g, (match) => {
    const key = match.slice(2, -2);
    if (requiredSet.has(key)) return match; // leave required placeholders for the warning below
    return '';
  });

  // Warn if any required {{ARCHITXT_*}} placeholders remain.
  const remaining = prompt.match(/\\{\\{ARCHITXT_[A-Z_]+\\}\\}/g) || [];
  if (remaining.length > 0) {
    logger.warn('Unsubstituted ARCHITXT variables in composed prompt', { template: template.pt_name, remaining });
  }

  return {
    prompt,
    mode: template.pt_mode,
  };
}

/**
 * Convenience: load template by name and compose it.
 *
 * @param {object} db
 * @param {string} name
 * @param {Record<string, string>} variables
 * @returns {{prompt: string, mode: string}}
 */
export function loadAndCompose(db, name, variables) {
  const template = getTemplateByName(db, name);
  if (!template) {
    throw new Error(`Prompt template not found: ${name}`);
  }
  return composePrompt(template, variables);
}

/**
 * Load template by name and compose it, auto-populating ARCHITXT_ENTITIES from the DB catalog.
 *
 * @param {object} db
 * @param {string} name
 * @param {Record<string, string>} variables
 * @returns {Promise<{prompt: string, mode: string}>}
 */
export async function loadAndComposeWithCatalog(db, name, variables = {}) {
  const entityCatalog = await buildEntityCatalogVariable(db);
  const template = getTemplateByName(db, name);
  if (!template) {
    throw new Error(`Prompt template not found: ${name}`);
  }

  let examples = variables.ARCHITXT_NODE_EXAMPLES;
  if (examples === undefined && template.pt_examples_heuristic) {
    const entities = await loadEntityCatalog(db);
    const result = applyHeuristic(template.pt_examples_heuristic, entities);
    examples = formatNodeExamples(result);
  }

  return composePrompt(template, {
    ARCHITXT_ENTITIES: entityCatalog,
    ARCHITXT_NODE_EXAMPLES: examples || '',
    ...variables,
  });
}

function formatNodeExamples({ include, exclude }) {
  const lines = [];
  if (include?.length) {
    lines.push('Include as nodes:', ...include.map((e) => `- ${e}`));
  }
  if (exclude?.length) {
    lines.push('Do NOT include as nodes:', ...exclude.map((e) => `- ${e}`));
  }
  return lines.join('\n');
}

/**
 * Compose a full prompt for a derived mental model.
 *
 * @param {object} db
 * @param {string} templateName - value from mental_models.mm_returns
 * @param {string} topic - rendered mm_source_query after single-brace substitution
 * @returns {Promise<string>}
 */
export async function composeMentalModelPrompt(db, templateName, topic) {
  const { prompt } = await loadAndComposeWithCatalog(db, templateName, {
    ARCHITXT_TOPIC: topic || '',
  });
  return prompt;
}

/**
 * Compose many mental-model prompts in one pass.
 *
 * This avoids rebuilding the entity catalog and re-looking-up templates for
 * every row, which is the dominant cost when diffing banks with hundreds of
 * derived mental models.
 *
 * @param {object} db
 * @param {Array<{returns: string, source_query: string}>} items
 * @returns {Promise<Array<{composed_query: string|null, compose_error?: string}>>}
 */
export async function composeMentalModelPromptBatch(db, items) {
  if (!Array.isArray(items) || items.length === 0) {
    return [];
  }

  // Shared, expensive lookups done exactly once.
  const entityCatalog = await buildEntityCatalogVariable(db);
  let entities = null; // only loaded if a template needs heuristic examples

  const templatesByName = new Map();
  const examplesByTemplate = new Map();

  // Pre-load every unique template so we don't query per row.
  const uniqueNames = new Set(items.map((i) => i.returns).filter(Boolean));
  for (const name of uniqueNames) {
    const template = getTemplateByName(db, name);
    if (template) templatesByName.set(name, template);
  }

  const results = [];
  for (const item of items) {
    const template = templatesByName.get(item.returns);
    if (!template) {
      results.push({ composed_query: null, compose_error: `Prompt template not found: ${item.returns}` });
      continue;
    }

    try {
      let examples = '';
      if (template.pt_examples_heuristic) {
        if (!examplesByTemplate.has(template.pt_name)) {
          if (entities === null) {
            entities = await loadEntityCatalog(db);
          }
          const result = applyHeuristic(template.pt_examples_heuristic, entities);
          examples = formatNodeExamples(result);
          examplesByTemplate.set(template.pt_name, examples);
        } else {
          examples = examplesByTemplate.get(template.pt_name);
        }
      }

      const { prompt } = composePrompt(template, {
        ARCHITXT_ENTITIES: entityCatalog,
        ARCHITXT_NODE_EXAMPLES: examples,
        ARCHITXT_TOPIC: item.source_query || '',
      });
      results.push({ composed_query: prompt });
    } catch (err) {
      logger.warn('Failed to compose mental model prompt in batch', {
        template: item.returns,
        error: err.message,
      });
      results.push({ composed_query: null, compose_error: err.message });
    }
  }

  return results;
}
