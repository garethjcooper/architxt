/**
 * Query token extraction for the research discovery pipeline.
 *
 * Mirrors the frontend token language:
 *   [[Label (id)]]                e.g. [[ICMS (COM-002)]]
 *   [[src — label → target]]      e.g. [[ICMS — depends-on → Billing]]
 */

// [[Label (id)]]
const ENTITY_TOKEN_RE = /\[\[[^\[\]]+?\s*\([^\)]+?\)\]\]/g;
// [[src — label → target]]
const EDGE_TOKEN_RE = /\[\[[^\[\]—]+?\s*—\s*[^\[\]—→]+?\s*→\s*[^\[\]]+?\]\]/g;

export function parseEntityTokens(query) {
  if (typeof query !== 'string') return [];
  const tokens = [];
  for (const match of query.matchAll(ENTITY_TOKEN_RE)) {
    const inner = match[0].slice(2, -2);
    const parenIdx = inner.lastIndexOf('(');
    const label = parenIdx > 0 ? inner.slice(0, parenIdx).trim() : inner.trim();
    const id = parenIdx > 0 ? inner.slice(parenIdx + 1, -1).trim() : inner.trim();
    tokens.push({ kind: 'entity', raw: match[0], id, label, index: match.index ?? 0 });
  }
  return tokens.sort((a, b) => a.index - b.index);
}

export function parseEdgeTokens(query) {
  if (typeof query !== 'string') return [];
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

export function extractEntityIds(query) {
  return [...new Set(parseEntityTokens(query).map((t) => t.id))];
}

export function extractEdgeTokens(query) {
  return parseEdgeTokens(query);
}
