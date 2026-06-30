/**
 * Research intent parsing and topic helpers.
 *
 * The old >>Verb<< intent marker concept has been removed. The query text itself
 * now conveys intent, and the only inline tokens are entity and edge references:
 *   [[Label (id)]]                e.g. [[ICMS (COM-002)]]
 *   [[src — label → target]]      e.g. [[ICMS — depends-on → Billing]]
 */

export const GOALS = [
  'describe',
  'summarize',
  'compare',
  'trace',
  'find',
  'explain',
  'assess',
];

const GOAL_SET = new Set(GOALS);

export function isValidGoal(goal) {
  return GOAL_SET.has(goal);
}

// [[Label (id)]]
const ENTITY_TOKEN_RE = /\[\[[^\[\]]+?\s*\([^\)]+?\)\]\]/g;
// [[src — label → target]]
const EDGE_TOKEN_RE = /\[\[[^\[\]—]+?\s*—\s*[^\[\]—→]+?\s*→\s*[^\[\]]+?\]\]/g;

export function parseEntityTokens(query) {
  const tokens = [];
  for (const match of query.matchAll(ENTITY_TOKEN_RE)) {
    const inner = match[0].slice(2, -2);
    const parenIdx = inner.lastIndexOf('(');
    const label = parenIdx > 0 ? inner.slice(0, parenIdx).trim() : inner.trim();
    const rawId = parenIdx > 0 ? inner.slice(parenIdx + 1, -1).trim() : inner.trim();
    const colonIdx = rawId.indexOf(':');
    const type = colonIdx > 0 ? rawId.slice(0, colonIdx) : null;
    const id = colonIdx > 0 ? rawId.slice(colonIdx + 1) : rawId;
    tokens.push({ kind: 'entity', raw: match[0], id, type, label, index: match.index ?? 0 });
  }
  return tokens.sort((a, b) => a.index - b.index);
}

export function parseEdgeTokens(query) {
  const tokens = [];
  for (const match of query.matchAll(EDGE_TOKEN_RE)) {
    const inner = match[0].slice(2, -2);
    const parts = inner.split(/\s*—\s*|\s*→\s*/);
    if (parts.length >= 3) {
      const source = parts[0].trim();
      const edgeLabel = parts[1].trim();
      const target = parts.slice(2).join(' → ').trim();
      tokens.push({
        kind: 'edge',
        raw: match[0],
        id: `${source}|${target}|${edgeLabel}`,
        source,
        target,
        label: edgeLabel,
        index: match.index ?? 0,
      });
    }
  }
  return tokens.sort((a, b) => a.index - b.index);
}

export function parseAllTokens(query) {
  return [...parseEntityTokens(query), ...parseEdgeTokens(query)].sort(
    (a, b) => a.index - b.index,
  );
}

function formatSelectionReference(selection) {
  if (selection.kind !== 'entity') return selection.label || selection.id;
  if (selection.type) return `${selection.label || selection.id} (${selection.type}:${selection.id})`;
  return selection.label || selection.id;
}

/**
 * Build a scoped Hindsight query for a single topic.
 *
 * The returned string is assembled in explicit sections so the final prompt is
 * always traceable. No hidden combinations of values.
 */
export function buildTopicQuery(topic, globalOptions = {}) {
  const parts = [topic.text];

  if (topic.selections && topic.selections.length > 0) {
    const extra = topic.selections.filter((s) => {
      const label = s.label || '';
      const id = s.id || '';
      return !textMentionsEntity(topic.text, label) && !textMentionsEntity(topic.text, id);
    });
    if (extra.length > 0) {
      parts.push(`Selected entities: ${extra.map(formatSelectionReference).join(', ')}`);
    }
  }

  // Parsed entity/edge tokens are already present in topic.text, so don't
  // duplicate them as "Relevant entities" / "Relevant relationships".

  if (globalOptions.types?.length) {
    parts.push(`Limit to types: ${globalOptions.types.join(', ')}`);
  }

  if (globalOptions.tags?.length) {
    parts.push(`Filter by tags: ${globalOptions.tags.join(', ')}`);
  }

  return parts.join('\n\n');
}

function textMentionsEntity(text, value) {
  if (!value || !text) return false;
  const lowerText = text.toLowerCase();
  const lowerValue = value.toLowerCase();
  return lowerText.includes(`[[${lowerValue}`) || lowerText.includes(lowerValue);
}

/**
 * Build a compact selection payload from parsed query tokens.
 *
 * Only tokens that are explicitly in the query are included. The legacy
 * focus-derived selection model (source/kind/ids/action/context) is no longer
 * emitted by the UI; this minimal shape is what the agent stores and renders
 * into scoped recall queries.
 */
export function buildSelectionPayload(tokens) {
  return tokens
    .filter((t) => t.kind === 'entity' || t.kind === 'edge')
    .map((t) => ({
      id: t.id,
      kind: t.kind,
      label: t.label || t.id,
      ...(t.kind === 'entity' && t.type ? { type: t.type } : {}),
    }));
}

export default {
  GOALS,
  isValidGoal,
  parseAllTokens,
  parseEntityTokens,
  parseEdgeTokens,
  buildTopicQuery,
  buildSelectionPayload,
};
