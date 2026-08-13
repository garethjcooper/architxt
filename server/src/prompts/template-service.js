import { stmt } from '../cache.js';
import { createLogger } from '../utils/logger.js';
import { composeFragments } from './fragment-loader.js';
import { buildEntityCatalogVariable, loadEntityCatalog } from './entity-catalog.js';
import { applyHeuristic } from './examples-heuristics/index.js';
import { parseSectionDirectives } from './section-directives.js';

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

/**
 * Compute active/empty section lists from parsed directives.
 *
 * @param {{graph?:string, table?:Array, narrative?:string}} sectionFocus
 * @returns {{active: string[], empty: string[]}}
 */
function computeSectionState(sectionFocus) {
  const active = [];
  const empty = [];
  if (sectionFocus?.graph) active.push('graph');
  else empty.push('graph');
  if (sectionFocus?.table?.length) active.push('tables');
  else empty.push('tables');
  if (sectionFocus?.narrative) active.push('narrative');
  else empty.push('narrative');
  // If no directives at all, narrative is the default fallback.
  if (active.length === 0) {
    return { active: ['narrative'], empty: ['graph', 'tables'] };
  }
  return { active, empty };
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
 * Build conditional output-format fragments based on parsed section directives.
 *
 * Only includes schema fragments when the corresponding directive is present,
 * keeping prompt size minimal and preventing the LLM from hallucinating
 * unrequested sections.
 *
 * @param {{graph?:string, table?:Array, narrative?:string}} sectionFocus
 * @returns {string[]}
 */
function buildConditionalFragments(sectionFocus) {
  const extra = [];
  if (sectionFocus?.graph) {
    extra.push('output-format-graph-contextual.md');
  }
  if (sectionFocus?.table) {
    extra.push('output-format-table-contextual.md');
  }
  return extra;
}

/**
 * Merge conditional fragments into a template's static fragment list.
 *
 * @param {object} template - prompt_templates row (pt_fragments is a JSON string)
 * @param {string[]} extraFragments
 * @returns {object} New template-like object with merged fragments
 */
function mergeFragments(template, extraFragments) {
  const base = JSON.parse(template.pt_fragments || '[]');
  // Insert conditional fragments right after contextual-patch.md (if present)
  // so they precede section-focus.md and semantic fragments.
  const patchIndex = base.indexOf('contextual-patch.md');
  if (patchIndex !== -1 && extraFragments.length > 0) {
    base.splice(patchIndex + 1, 0, ...extraFragments);
  } else {
    base.push(...extraFragments);
  }
  return {
    ...template,
    pt_fragments: JSON.stringify(base),
  };
}

/**
 * Format active/empty section instructions for injection into a composed prompt.
 *
 * @param {{active: string[], empty: string[]}} sectionState
 * @returns {string}
 */
function formatSectionInstructions({ active, empty }) {
  const lines = [];
  lines.push('### Section rules');
  lines.push('');
  lines.push(`Active output sections: ${active.map((s) => `\`${s}\``).join(', ')}.`);
  lines.push(`Empty output sections (must remain exactly as shown in the envelope example): ${empty.map((s) => `\`${s}\``).join(', ')}.`);
  lines.push('');
  if (!active.includes('narrative')) {
    lines.push('Do not answer the topic in narrative prose. All findings must be expressed through the structured output sections above.');
    lines.push('');
  }
  return lines.join('\n');
}

/**
 * Inject section instructions into a composed prompt, placing them before
 * the "## Output directives" heading if it exists.
 *
 * @param {string} prompt
 * @param {string} instructions
 * @returns {string}
 */
function injectBeforeOutputDirectives(prompt, instructions) {
  const match = prompt.match(/\n## Output directives/i);
  if (match) {
    const idx = match.index;
    return prompt.slice(0, idx) + '\n' + instructions + '\n' + prompt.slice(idx);
  }
  return prompt + '\n' + instructions;
}
function buildFocusFromDirectives(topic) {
  const { intentText, sectionFocus } = parseSectionDirectives(topic || '');
  return {
    topic: intentText,
    sectionFocus,
    focusVariables: {
      ARCHITXT_GRAPH_FOCUS: formatFocusVariable(sectionFocus?.graph || ''),
      ARCHITXT_TABLE_FOCUS: formatFocusVariable(sectionFocus?.table || ''),
      ARCHITXT_NARRATIVE_FOCUS: formatFocusVariable(sectionFocus?.narrative || ''),
    },
  };
}
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
  if (CONTEXTUAL_MODES.has(templateName) || templateName === 'generic') {
    const template = getTemplateByName(db, templateName);
    if (!template) {
      throw new Error(`Prompt template not found: ${templateName}`);
    }
    const { topic: parsedTopic, focusVariables: parsedFocus, sectionFocus } = buildFocusFromDirectives(topic);

    // Load entity catalog and examples for generic template (same as non-contextual path)
    let entityCatalog = '';
    let examples = '';
    if (templateName === 'generic') {
      entityCatalog = await buildEntityCatalogVariable(db);
      if (template.pt_examples_heuristic) {
        const entities = await loadEntityCatalog(db);
        const result = applyHeuristic(template.pt_examples_heuristic, entities);
        examples = formatNodeExamples(result);
      }
    }

    const merged = {
      ARCHITXT_TOPIC: parsedTopic || '',
      ARCHITXT_GRAPH_FOCUS: '',
      ARCHITXT_TABLE_FOCUS: '',
      ARCHITXT_NARRATIVE_FOCUS: '',
      ARCHITXT_ENTITIES: entityCatalog,
      ARCHITXT_NODE_EXAMPLES: examples,
      ...parsedFocus,
      ...focusVariables,
    };
    const extra = buildConditionalFragments(sectionFocus);
    const effectiveTemplate = extra.length > 0 ? mergeFragments(template, extra) : template;
    const { prompt } = composePrompt(effectiveTemplate, merged);
    const sectionState = computeSectionState(sectionFocus);
    const instructions = formatSectionInstructions(sectionState);
    return injectBeforeOutputDirectives(prompt, instructions);
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
      const { topic: parsedTopic, focusVariables: parsedFocus, sectionFocus } = buildFocusFromDirectives(item.source_query);
      const variables = {
        ARCHITXT_TOPIC: parsedTopic || '',
        ARCHITXT_GRAPH_FOCUS: '',
        ARCHITXT_TABLE_FOCUS: '',
        ARCHITXT_NARRATIVE_FOCUS: '',
        ...parsedFocus,
      };

      if (!CONTEXTUAL_MODES.has(lookupKey) || lookupKey === 'generic') {
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

      const extra = buildConditionalFragments(sectionFocus);
      const effectiveTemplate = extra.length > 0 ? mergeFragments(template, extra) : template;
      const { prompt } = composePrompt(effectiveTemplate, variables);
      const sectionState = computeSectionState(sectionFocus);
      const instructions = formatSectionInstructions(sectionState);
      const finalPrompt = injectBeforeOutputDirectives(prompt, instructions);
      results.push({ composed_query: finalPrompt });
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
