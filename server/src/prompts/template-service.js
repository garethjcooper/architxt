import { stmt } from '../cache.js';
import { createLogger } from '../utils/logger.js';
import { composeFragments } from './fragment-loader.js';
import { buildEntityCatalogVariable, loadEntityCatalog } from './entity-catalog.js';
import { applyHeuristic } from './examples-heuristics/index.js';

const logger = createLogger('prompt-templates');

const VALID_MODES = new Set([
  'generic',
  'sys_entity_summary',
  'sys_entity_capabilities',
  'sys_edge_context',
  'sys_discovery_context',
]);

const CONTEXTUAL_MODES = new Set([
  'sys_entity_summary',
  'sys_entity_capabilities',
  'sys_edge_context',
  'sys_discovery_context',
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
    return value === undefined || value === null;
  });
  if (missing.length > 0) {
    throw new Error(`Missing required variables for template ${template.pt_name}: ${missing.join(', ')}`);
  }

  const fragments = JSON.parse(template.pt_fragments || '[]');
  const fragmentText = composeFragments(fragments);
  const body = template.pt_body || '';
  const composed = fragmentText ? `${body}\n\n${fragmentText}` : body;
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
 * Default focus directives for contextual-graph system templates.
 * These are auto-injected when callers do not supply focus variables,
 * preserving historical single-purpose behavior while keeping the template
 * bodies fully directive-driven.
 */
const DEFAULT_FOCUS_BY_TEMPLATE = {
  sys_entity_summary: {
    ARCHITXT_NARRATIVE_FOCUS: '- Summarise the core role of the entity in the architecture',
  },
  sys_entity_capabilities: {
    ARCHITXT_TABLE_FOCUS: '- List the major architectural capabilities of the entity',
  },
  sys_edge_context: {
    ARCHITXT_GRAPH_FOCUS: '- Describe every distinct directed flow between the two endpoints',
  },
  sys_discovery_context: {
    ARCHITXT_GRAPH_FOCUS: '- Discover candidate entities and relationships around the seed entity',
  },
};
/**
 * Format a raw focus string (or array of strings / table directives) into bullet
 * or blank.
 *
 * When an array of strings is provided, each item becomes its own bullet line.
 * When an array of table directives is provided, each renders as:
 *   - **Name** — description  (if name is present)
 *   - description               (if name is omitted; LLM should generate one)
 *
 * This aligns with SECTION_DIRECTIVE_CONFIG cardinality rules in the frontend:
 *   - #graph, #narrative → single string (one bullet)
 *   - #table             → TableDirective[] (one per table, with optional name)
 *
 * @param {string|string[]|{name?:string,content:string}[]} [raw]
 * @returns {string}
 */
export function formatFocusVariable(raw) {
  // Table directives
  if (Array.isArray(raw) && raw.length > 0 && typeof raw[0] === 'object' && raw[0] !== null && 'content' in raw[0]) {
    const directives = /** @type {{name?:string,content:string}[]} */ (raw);
    const lines = directives
      .filter((d) => d.content?.trim() !== '')
      .map((d) => {
        const content = d.content.trim();
        if (d.name?.trim()) return `- **${d.name.trim()}** — ${content}`;
        return `- ${content}`;
      });
    return lines.join('\n');
  }

  // String array (graph/narrative multiple scopes, or legacy table array)
  if (Array.isArray(raw)) {
    const lines = raw.filter((s) => typeof s === 'string' && s.trim() !== '').map((s) => `- ${s.trim()}`);
    return lines.join('\n');
  }

  if (!raw || typeof raw !== 'string' || raw.trim() === '') return '';
  return `- ${raw.trim()}`;
}

/**
 * Compose a full prompt for a derived mental model.
 *
 * @param {object} db
 * @param {string} templateName - value from mental_models.mm_template_role for
 *   contextual-graph system templates, or mental_models.mm_returns for all others.
 * @param {string} topic - rendered mm_source_query after single-brace substitution
 * @param {Record<string, string>} [focusVariables] - Optional per-section focus variables
 *   (ARCHITXT_GRAPH_FOCUS, ARCHITXT_TABLE_FOCUS, ARCHITXT_NARRATIVE_FOCUS).
 * @returns {Promise<string>}
 */
export async function composeMentalModelPrompt(db, templateName, topic, focusVariables = {}) {
  // Contextual-graph system templates are keyed by mm_template_role, not by
  // mm_returns (which is now the generic 'sys_patch' placeholder).
  if (CONTEXTUAL_MODES.has(templateName)) {
    const template = getTemplateByName(db, templateName);
    if (!template) {
      throw new Error(`Prompt template not found: ${templateName}`);
    }
    const defaults = DEFAULT_FOCUS_BY_TEMPLATE[templateName] || {};
    const merged = {
      ARCHITXT_TOPIC: topic || '',
      ARCHITXT_GRAPH_FOCUS: '',
      ARCHITXT_TABLE_FOCUS: '',
      ARCHITXT_NARRATIVE_FOCUS: '',
      ...defaults,
      ...focusVariables,
    };
    const { prompt } = composePrompt(template, merged);
    return prompt;
  }

  const { prompt } = await loadAndComposeWithCatalog(db, templateName, {
    ARCHITXT_TOPIC: topic || '',
    ...focusVariables,
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
 * @param {Array<{returns: string, source_query: string, role?: string, template_role?: string}>} items
 * @returns {Promise<Array<{composed_query: string|null, compose_error?: string}>>}
 */
export async function composeMentalModelPromptBatch(db, items) {
  if (!Array.isArray(items) || items.length === 0) {
    return [];
  }

  const templatesByName = new Map();
  const examplesByTemplate = new Map();

  // Pre-load every unique template so we don't query per row.
  // For contextual-graph rows the lookup key is role/template_role; for all
  // others it is mm_returns.
  const uniqueNames = new Set(items.map((i) => i.role || i.template_role || i.returns).filter(Boolean));
  for (const name of uniqueNames) {
    const template = getTemplateByName(db, name);
    if (template) templatesByName.set(name, template);
  }

  // Shared, expensive lookups done exactly once, and only if a non-contextual
  // template actually needs them.
  let entityCatalog = null;
  let entities = null;

  const results = [];
  for (const item of items) {
    const lookupKey = item.role || item.template_role || item.returns;
    const template = templatesByName.get(lookupKey);
    if (!template) {
      results.push({ composed_query: null, compose_error: `Prompt template not found: ${lookupKey}` });
      continue;
    }

    try {
      const defaults = CONTEXTUAL_MODES.has(lookupKey)
        ? (DEFAULT_FOCUS_BY_TEMPLATE[lookupKey] || {})
        : {};
      const variables = {
        ARCHITXT_TOPIC: item.source_query || '',
        ARCHITXT_GRAPH_FOCUS: '',
        ARCHITXT_TABLE_FOCUS: '',
        ARCHITXT_NARRATIVE_FOCUS: '',
        ...defaults,
      };

      if (!CONTEXTUAL_MODES.has(lookupKey)) {
        if (entityCatalog === null) {
          entityCatalog = await buildEntityCatalogVariable(db);
        }
        variables.ARCHITXT_ENTITIES = entityCatalog;

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
        variables.ARCHITXT_NODE_EXAMPLES = examples;
      }

      const { prompt } = composePrompt(template, variables);
      results.push({ composed_query: prompt });
    } catch (err) {
      logger.warn('Failed to compose mental model prompt in batch', {
        template: lookupKey,
        error: err.message,
      });
      results.push({ composed_query: null, compose_error: err.message });
    }
  }

  return results;
}
