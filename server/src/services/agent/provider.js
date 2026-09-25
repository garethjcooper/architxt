import { generateCompletion } from '../llm/client.js';
import { config } from '../../config.js';
import { createLogger } from '../../utils/logger.js';

const logger = createLogger('agent-provider');

function getProviderEntry() {
  const { provider: providerName, base_url, api_key, timeout_ms } = config.agent;
  const model = config.agent.model;

  if (!providerName) {
    return { error: 'No agent provider configured', code: 'AGENT_PROVIDER_NOT_CONFIGURED' };
  }
  if (!model) {
    return { error: 'No agent model configured', code: 'AGENT_MODEL_NOT_CONFIGURED' };
  }

  const providerEntry = config.providers?.[providerName];
  if (!providerEntry) {
    return {
      error: `Unknown agent provider: ${providerName}. Available: ${Object.keys(config.providers || {}).join(', ')}`,
      code: 'UNKNOWN_AGENT_PROVIDER',
    };
  }

  return {
    providerEntry: {
      ...providerEntry,
      base_url: base_url || providerEntry.base_url,
      api_key: api_key || providerEntry.api_key,
      timeout_ms: timeout_ms || providerEntry.timeout_ms,
    },
    model,
  };
}

function buildLlmProvenance(toolName, messages, request, result) {
  const base = {
    tool: toolName,
    mode: 'llm',
    request: { messages, ...request },
  };
  if (!result.success) {
    return {
      ...base,
      status: 'failure',
      duration_ms: result.duration_ms ?? null,
      error: result.error,
      code: result.code,
      response: null,
    };
  }
  return {
    ...base,
    status: 'success',
    duration_ms: result.data.duration_ms ?? null,
    response: {
      content: result.data.content,
      model: result.data.model,
      usage: result.data.usage,
      finish_reason: result.data.finishReason ?? null,
    },
  };
}

const VALID_FOCUS_TYPES = ['narrative', 'graph', 'table', 'diagram'];
const VALID_DIAGRAM_TYPES = [
  'flowchart',
  'sequenceDiagram',
  'classDiagram',
  'stateDiagram',
  'erDiagram',
  'gantt',
  'pie',
  'quadrantChart',
  'timeline',
  'gitGraph',
  'architecture-beta',
];
const DEFAULT_DIAGRAM_TYPE = 'flowchart';

const INTENT_CLASSIFIER_SYSTEM_PROMPT = `You are an intent classifier for the architxt Workspace chat agent.

Given a user message, decide which output sections the response should include.

Allowed section types:
- narrative: explanatory text, prose, or summary
- graph: nodes and edges / relationships
- table: rows and columns of structured data
- diagram: a Mermaid-style visualization

Allowed diagram types (only meaningful when a section has focus "diagram"):
- flowchart
- sequenceDiagram
- classDiagram
- stateDiagram
- erDiagram
- gantt
- pie
- quadrantChart
- timeline
- gitGraph
- architecture-beta

Rules:
1. Include any section type the user explicitly names (diagram, graph, table, narrative). Default to one narrative section when none is specified.
2. Keep the list minimal: only include types clearly implied by the query. Ambiguous queries default to a single narrative.
3. If the user asks for a visual of connections AND also asks for details/list/connection details, add a "table" section when the details are numerous or structured.
4. When a "diagram" section is selected, set "diagram_type" to one of the allowed diagram types. Default "flowchart" unless the query clearly implies another.
5. Provide a concise, title-cased "name" for every section.
6. Respond ONLY with raw JSON matching this exact shape. No markdown code fences, no prose, no explanation.

Example response:
{"focus":["diagram","table"],"explicit":true,"sections":[{"focus":"diagram","name":"Audit Logger connections","query":"Identify every entity that sends data to or receives data from Audit Logger, plus the direction, protocol, and content of each flow.","diagram_type":"flowchart"},{"focus":"table","name":"Connection details","query":"List each Audit Logger connection with source, target, protocol, and content."}],"reason":"User asked for a diagram and detailed list."}

Allowed section types: narrative, graph, table, diagram.

Every section must have a "query": a short, specific sub-query that an LLM or data agent could answer to produce that section. The sub-query should reference the original subject and any attributes the user asked for (direction, protocol, content, etc.). Keep each query to one sentence. If only a narrative section is selected, the query can simply restate the user's request.
`;

const EXAMPLE_CLASSIFIER_OUTPUT = '{"focus":["narrative"],"explicit":false,"sections":[{"focus":"narrative","name":"Summary","query":"Summarize the user request in prose."}],"reason":"No output type was specified."}';

function normalizeFocusList(list) {
  if (!Array.isArray(list)) return ['narrative'];
  const normalized = list
    .map((f) => (typeof f === 'string' ? f.toLowerCase().trim() : ''))
    .filter((f) => VALID_FOCUS_TYPES.includes(f));
  const unique = [...new Set(normalized)];
  return unique.length > 0 ? unique : ['narrative'];
}

function ensureIntentSections(intent, userMessage) {
  if (Array.isArray(intent.sections) && intent.sections.length > 0) return intent;
  const sections = [];
  const focusList = normalizeFocusList(intent.focus);
  for (const focus of focusList) {
    const name = intent.names?.[focus] || defaultNameForFocus(focus, userMessage);
    const query = intent.queries?.[focus] || defaultQueryForFocus(focus, intent.diagram_type || null, userMessage);
    const section = { focus, name, query };
    if (focus === 'diagram') {
      section.diagram_type = normalizeDiagramType(intent.diagram_type) || DEFAULT_DIAGRAM_TYPE;
    }
    if (focus === 'table') {
      section.table = { columns: normalizeColumns(intent.table) || defaultTableColumns(userMessage) };
    }
    sections.push(section);
  }
  intent.sections = sections;
  return intent;
}

function extractSubject(userMessage) {
  if (!userMessage || typeof userMessage !== 'string') return null;
  const cleaned = userMessage
    .replace(/\b(generate|produce|create|make|show|give|list|describe|explain|tell|write|return|a|the|of|and|details|connection|connections)\b/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  const words = cleaned.split(' ').filter(Boolean);
  if (words.length === 0) return null;
  return words.slice(0, 4).join(' ');
}

function defaultNameForFocus(focus, userMessage) {
  const subject = extractSubject(userMessage);
  const titleSubject = subject ? `${subject.charAt(0).toUpperCase()}${subject.slice(1)}` : null;
  switch (focus) {
    case 'diagram':
      return titleSubject ? `${titleSubject} diagram` : 'Overview diagram';
    case 'table':
      return titleSubject ? `${titleSubject} details` : 'Details';
    case 'graph':
      return titleSubject ? `${titleSubject} graph` : 'Relationships';
    case 'narrative':
    default:
      return titleSubject ? `${titleSubject} summary` : 'Summary';
  }
}

function defaultQueryForFocus(focus, diagramType, userMessage) {
  const subject = extractSubject(userMessage) || 'the requested topic';
  switch (focus) {
    case 'diagram': {
      const type = diagramType || 'flowchart';
      return `Show ${subject} as a ${type} diagram.`;
    }
    case 'graph':
      return `Show ${subject} as a graph of nodes and edges.`;
    case 'table':
      return `List ${subject} in a structured table.`;
    case 'narrative':
    default:
      return `Provide a description of ${subject}.`;
  }
}

function normalizeNames(parsedNames, focusList, userMessage) {
  const names = {};
  const input = parsedNames && typeof parsedNames === 'object' && !Array.isArray(parsedNames) ? parsedNames : {};
  for (const focus of focusList) {
    const value = input[focus];
    names[focus] =
      typeof value === 'string' && value.trim().length > 0
        ? value.trim()
        : defaultNameForFocus(focus, userMessage);
  }
  return names;
}

function sectionKey(section) {
  return `${section.focus}:${(section.name || '').toLowerCase().trim()}`;
}

function normalizeSections(input, userMessage) {
  const sections = [];
  if (input && Array.isArray(input.sections)) {
    for (const raw of input.sections) {
      if (!raw || typeof raw !== 'object') continue;
      const focus = normalizeFocusList([raw.focus])?.[0] || 'narrative';
      const name = typeof raw.name === 'string' && raw.name.trim().length > 0
        ? raw.name.trim()
        : defaultNameForFocus(focus, userMessage);
      const query = typeof raw.query === 'string' && raw.query.trim().length > 0
        ? raw.query.trim()
        : defaultQueryForFocus(focus, raw.diagram_type || null, userMessage);
      const section = { focus, name, query };
      if (focus === 'diagram') {
        section.diagram_type = normalizeDiagramType(raw.diagram_type) || DEFAULT_DIAGRAM_TYPE;
      }
      if (focus === 'table') {
        const columns = normalizeColumns(raw.table) || normalizeColumns(raw.columns) || defaultTableColumns(userMessage);
        section.table = { columns };
      }
      sections.push(section);
    }
  }

  if (sections.length === 0) {
    // Legacy fallback: synthesize a single section per focus from names/queries maps.
    const focusList = normalizeFocusList(input?.focus);
    const names = normalizeNames(input?.names, focusList, userMessage);
    const queries = normalizeQueries(input?.queries, focusList, userMessage);
    for (const focus of focusList) {
      const section = { focus, name: names[focus], query: queries[focus] };
      if (focus === 'diagram') {
        section.diagram_type = normalizeDiagramType(input?.diagram_type) || DEFAULT_DIAGRAM_TYPE;
      }
      if (focus === 'table') {
        section.table = { columns: normalizeColumns(input?.table) || defaultTableColumns(userMessage) };
      }
      sections.push(section);
    }
  }

  // Deduplicate by focus+name, keeping the first occurrence.
  const seen = new Set();
  return sections.filter((s) => {
    const key = sectionKey(s);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function deriveNamesAndQueries(sections) {
  const names = {};
  const queries = {};
  for (const s of sections) {
    names[s.focus] = s.name;
    queries[s.focus] = s.query;
  }
  return { names, queries };
}

function deriveFocusFromSections(sections) {
  return [...new Set(sections.map((s) => s.focus))];
}

function parseIntentJson(text) {
  if (!text || typeof text !== 'string') return null;
  let cleaned = text.trim();

  // Strip markdown code fences if present.
  cleaned = cleaned.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim();

  // Try a direct parse first.
  try {
    return JSON.parse(cleaned);
  } catch {
    // Continue to extraction.
  }

  // Extract the first balanced {...} object.
  const start = cleaned.indexOf('{');
  if (start === -1) return null;
  let depth = 0;
  let inString = false;
  let escape = false;
  let end = -1;
  for (let i = start; i < cleaned.length; i += 1) {
    const ch = cleaned[i];
    if (escape) {
      escape = false;
      continue;
    }
    if (ch === '\\') {
      escape = true;
      continue;
    }
    if (ch === '"') {
      inString = !inString;
      continue;
    }
    if (inString) continue;
    if (ch === '{') depth += 1;
    else if (ch === '}') {
      depth -= 1;
      if (depth === 0) {
        end = i;
        break;
      }
    }
  }
  if (end === -1) return null;
  const jsonText = cleaned.slice(start, end + 1);
  try {
    return JSON.parse(jsonText);
  } catch {
    return null;
  }
}

function normalizeDiagramType(value) {
  if (typeof value !== 'string') return null;
  const normalized = value.trim().toLowerCase();
  const match = VALID_DIAGRAM_TYPES.find((t) => t.toLowerCase() === normalized);
  return match || null;
}

function normalizeColumns(parsedTable) {
  if (!parsedTable || typeof parsedTable !== 'object' || Array.isArray(parsedTable)) return null;
  const raw = parsedTable.columns;
  if (!Array.isArray(raw)) return null;
  const columns = raw
    .map((c) => (typeof c === 'string' ? c.trim() : ''))
    .filter((c) => c.length > 0 && c.length < 100)
    .slice(0, 12);
  return columns.length > 0 ? columns : null;
}

function defaultTableColumns(userMessage) {
  if (/connection/i.test(userMessage)) return ['Source', 'Target', 'Protocol', 'Port', 'Status', 'Notes'];
  if (/entity|component|service|system/i.test(userMessage)) return ['Name', 'Type', 'Description', 'Owner', 'Status'];
  if (/dependency|depend/i.test(userMessage)) return ['Source', 'Depends On', 'Relationship', 'Criticality'];
  if (/change|version|history/i.test(userMessage)) return ['Date', 'Version', 'Author', 'Change'];
  return ['Name', 'Description', 'Status', 'Notes'];
}

function normalizeQueries(parsedQueries, focusList, userMessage) {
  const queries = {};
  const input = parsedQueries && typeof parsedQueries === 'object' && !Array.isArray(parsedQueries) ? parsedQueries : {};
  for (const focus of focusList) {
    const value = input[focus];
    queries[focus] =
      typeof value === 'string' && value.trim().length > 0
        ? value.trim()
        : `Produce the ${focus} section for: ${userMessage}`;
  }
  return queries;
}

/**
 * Classify the user's desired output section focus.
 *
 * @param {string} userMessage
 * @returns {Promise<{intent: object, provenance: array}>}
 */
export async function classifyOutputIntent(userMessage) {
  const provenance = [];
  const entry = getProviderEntry();
  if (entry.error) {
    logger.warn('Output intent classification skipped: provider not configured', { error: entry.error, code: entry.code });
    const intent = {
      focus: ['narrative'],
      reason: `Intent classification unavailable: ${entry.error}`,
      explicit: false,
      names: { narrative: defaultNameForFocus('narrative', userMessage) },
      queries: { narrative: `Produce the narrative section for: ${userMessage}` },
    };
    ensureIntentSections(intent, userMessage);
    provenance.push({
      tool: 'classifyOutputIntent',
      mode: 'llm',
      status: 'failure',
      error: entry.error,
      code: entry.code,
      request: { userMessage },
      response: null,
    });
    return { intent, provenance };
  }

  const { model } = entry;
  const messages = [
    { role: 'system', content: INTENT_CLASSIFIER_SYSTEM_PROMPT },
    { role: 'user', content: userMessage },
  ];

  const request = {
    provider: config.agent.provider,
    model,
    temperature: 0,
    max_tokens: config.agent.classify_intent_max_tokens ?? 2048,
  };

  logger.info('Output intent classification request', { provider: config.agent.provider, model });

  const result = await generateCompletion(messages, request);

  provenance.push(buildLlmProvenance('classifyOutputIntent', messages, request, result));

  if (!result.success) {
    logger.warn('Output intent classification failed', { error: result.error, code: result.code, finishReason: result.data?.finishReason });
    const intent = {
      focus: ['narrative'],
      reason: `Intent classification failed: ${result.error}`,
      explicit: false,
      names: { narrative: defaultNameForFocus('narrative', userMessage) },
      queries: { narrative: `Produce the narrative section for: ${userMessage}` },
    };
    ensureIntentSections(intent, userMessage);
    return {
      intent,
      provenance,
    };
  }

  if (!result.data.content || typeof result.data.content !== 'string' || result.data.content.trim().length === 0) {
    logger.warn('Output intent classification returned empty content', { finishReason: result.data.finishReason, usage: result.data.usage });
    const intent = {
      focus: ['narrative'],
      reason: `Intent classification returned empty content (finishReason=${result.data.finishReason || 'unknown'}); defaulting to narrative.`,
      explicit: false,
      names: { narrative: defaultNameForFocus('narrative', userMessage) },
      queries: { narrative: `Produce the narrative section for: ${userMessage}` },
    };
    ensureIntentSections(intent, userMessage);
    return {
      intent,
      provenance,
    };
  }

  const parsed = parseIntentJson(result.data.content);
  if (!parsed || typeof parsed !== 'object') {
    logger.warn('Output intent classification returned unparseable JSON', { content: result.data.content });
    const intent = {
      focus: ['narrative'],
      reason: 'Intent classification returned unparseable output; defaulting to narrative.',
      explicit: false,
      names: { narrative: defaultNameForFocus('narrative', userMessage) },
      queries: { narrative: `Produce the narrative section for: ${userMessage}` },
    };
    ensureIntentSections(intent, userMessage);
    return {
      intent,
      provenance,
    };
  }

  const sections = normalizeSections(parsed, userMessage);
  const focus = deriveFocusFromSections(sections);
  const explicit = typeof parsed.explicit === 'boolean' ? parsed.explicit : focus.length > 1 || focus[0] !== 'narrative';
  const reason = typeof parsed.reason === 'string' && parsed.reason.trim().length > 0
    ? parsed.reason.trim()
    : `Suggested focus: ${focus.join(', ')}.`;
  const { names, queries } = deriveNamesAndQueries(sections);

  logger.info('Output intent classification result', { focus, explicit, reason, names, queries, sections, model: result.data.model });

  const intent = {
    focus,
    reason,
    explicit,
    names,
    queries,
    sections,
    model: result.data.model,
    usage: result.data.usage || null,
  };
  ensureIntentSections(intent, userMessage);
  return { intent, provenance };
}

export default {
  classifyOutputIntent,
};
