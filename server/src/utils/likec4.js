/**
 * LikeC4 DSL export.
 *
 * Produces a valid LikeC4 source file (.likec4) from the contextual graph.
 * Unlike the C4/Structurizr exporters, element kinds are NOT the fixed C4 set:
 * each architxt entity type becomes its own LikeC4 element kind, and each
 * edge type becomes a LikeC4 relationship kind. This file is fully
 * self-contained — it shares no mapping with the C4/ArchiMate exporters
 * except reading the optional et_likec4_shape column for the kind's shape
 * style (unset = default rectangle).
 *
 * Structure:
 *   specification { element <kind> ... relationship <kind> ... }
 *   model { <name> = <kind> 'Title' { ... } ...  src .rel dst 'title' ... }
 *   views { view index { include * } }
 *
 * Identifier rules (LikeC4 names/kinds): letters, digits, hyphens,
 * underscores; must not start with a digit; no dots. Names must be unique
 * within the (flat) model scope, so collisions get a numeric suffix.
 *
 * @see https://likec4.dev/dsl/
 */

const FALLBACK_KIND = 'element';
const FALLBACK_REL_KIND = 'relates-to';

/**
 * Sanitize an arbitrary string into a valid LikeC4 identifier
 * (letters, digits, hyphens, underscores; no leading digit).
 */
function makeIdentifier(value, fallback) {
  if (!value) return fallback;
  let sanitized = String(value)
    .replace(/[^A-Za-z0-9_-]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '');
  if (!sanitized) return fallback;
  if (/^[0-9]/.test(sanitized)) {
    sanitized = `id-${sanitized}`;
  }
  return sanitized;
}

/**
 * Ensure uniqueness within a scope: first occurrence keeps the name,
 * later collisions get -2, -3, ...
 */
function uniqueName(taken, name) {
  if (!taken.has(name)) {
    taken.add(name);
    return name;
  }
  let counter = 2;
  while (taken.has(`${name}-${counter}`)) counter++;
  const unique = `${name}-${counter}`;
  taken.add(unique);
  return unique;
}

/** Escape a value for a single-quoted LikeC4 string. */
function escapeDslString(value) {
  if (value === null || value === undefined) return '';
  return String(value)
    .replace(/\\/g, '\\\\')
    .replace(/'/g, "\\'")
    .replace(/\r?\n/g, '\\n');
}

/**
 * Quote a (possibly multi-line) value. Multi-line values use triple
 * single quotes, which LikeC4 treats as markdown.
 */
function quoteDsl(value) {
  if (value === null || value === undefined || value === '') return "''";
  const text = String(value);
  if (/\r?\n/.test(text)) {
    return `'''${text.replace(/\\/g, '\\\\').replace(/'''/g, "\\'\\'\\'")}'''`;
  }
  return `'${escapeDslString(text)}'`;
}

function nodeLabel(node) {
  return (
    node.properties?.name ||
    node.properties?.display_name ||
    node.properties?.label ||
    node.labels?.find((l) => l !== 'canonical' && l !== 'candidate') ||
    node.labels?.[0] ||
    node.id
  );
}

/**
 * Build a LikeC4 DSL representation of the graph.
 *
 * @param {Array<{id: string, labels: string[], properties: Record<string, any>}>} nodes
 * @param {Array<{id: string, source_id: string, target_id: string, type: string | null, properties: Record<string, any>}>} edges
 * @param {Object} meta
 * @param {boolean} undirected
 * @param {Map<string, {typeName: string | null, likec4Shape?: string | null, defaulted: boolean}>} nodeMap
 * @param {Map<string, {c4Description: string | null, typeName: string | null, defaulted: boolean}>} edgeMap
 * @returns {string}
 */
export function toLikeC4(nodes, edges, meta, undirected, nodeMap, edgeMap) {
  const lines = [];

  // node.id -> { name, kind }
  const emitted = new Map();
  const takenNames = new Set();
  const kindNames = new Map(); // typeName -> kind identifier
  const kindShapes = new Map(); // kind identifier -> shape
  const kindTitles = new Map(); // kind identifier -> original type name (when it differs)
  const takenKinds = new Set();

  const kindFor = (typeName) => {
    if (!typeName) return FALLBACK_KIND;
    if (kindNames.has(typeName)) return kindNames.get(typeName);
    const kind = uniqueName(takenKinds, makeIdentifier(typeName, FALLBACK_KIND));
    kindNames.set(typeName, kind);
    return kind;
  };

  for (const node of nodes) {
    const mapping = nodeMap.get(node.id) || {};
    const kind = kindFor(mapping.typeName);
    if (mapping.typeName) {
      const shape = mapping.likec4Shape || null;
      if (shape) kindShapes.set(kind, shape);
      if (kind !== mapping.typeName) kindTitles.set(kind, mapping.typeName);
    }
    const name = uniqueName(takenNames, makeIdentifier(node.id, 'node'));
    emitted.set(node.id, { name, kind });
  }

  // Edge relationship kinds: edge type name -> kind identifier.
  const relKindNames = new Map();
  const relKindTitles = new Map(); // kind -> description (used as default title)
  const takenRelKinds = new Set();
  const relKindFor = (typeName) => {
    if (!typeName) return null;
    if (relKindNames.has(typeName)) return relKindNames.get(typeName);
    const kind = uniqueName(takenRelKinds, makeIdentifier(typeName, FALLBACK_REL_KIND));
    relKindNames.set(typeName, kind);
    return kind;
  };

  for (const edge of edges) {
    const mapping = edgeMap.get(edge.id) || {};
    const kind = relKindFor(mapping.typeName);
    if (kind && mapping.typeName) {
      const title = mapping.c4Description || edge.properties?.label || mapping.typeName;
      if (!relKindTitles.has(kind)) relKindTitles.set(kind, title);
    }
  }

  // ── specification ──────────────────────────────────────────────
  lines.push('specification {');
  for (const kind of takenKinds) {
    const shape = kindShapes.get(kind);
    const original = kindTitles.get(kind);
    if (shape || original) {
      lines.push(`  element ${kind} {`);
      if (original) lines.push(`    title ${quoteDsl(original)}`);
      if (shape) lines.push(`    style {\n      shape ${shape}\n    }`);
      lines.push('  }');
    } else {
      lines.push(`  element ${kind}`);
    }
  }
  if (!takenKinds.has(FALLBACK_KIND)) lines.push(`  element ${FALLBACK_KIND}`);
  for (const kind of takenRelKinds) {
    const title = relKindTitles.get(kind);
    if (title) {
      lines.push(`  relationship ${kind} {`);
      lines.push(`    title ${quoteDsl(title)}`);
      lines.push('  }');
    } else {
      lines.push(`  relationship ${kind}`);
    }
  }
  lines.push('}');
  lines.push('');

  // ── model ──────────────────────────────────────────────────────
  lines.push('model {');
  for (const node of nodes) {
    const { name, kind } = emitted.get(node.id);
    const label = nodeLabel(node);
    const description = node.properties?.description || '';
    if (description) {
      lines.push(`  ${name} = ${kind} ${quoteDsl(label)} {`);
      lines.push(`    description ${quoteDsl(description)}`);
      lines.push('  }');
    } else {
      lines.push(`  ${name} = ${kind} ${quoteDsl(label)}`);
    }
  }

  const relLines = [];
  for (const edge of edges) {
    const source = emitted.get(edge.source_id);
    const target = emitted.get(edge.target_id);
    if (!source || !target) continue;

    const mapping = edgeMap.get(edge.id) || {};
    const title = mapping.c4Description || edge.properties?.label || edge.type || 'relates to';
    const kind = relKindFor(mapping.typeName);
    const isUndirected = undirected || edge.properties?.directed === false;
    const operator = isUndirected ? '<->' : '->';
    const middle = kind ? ` -[${kind}]${operator} ` : ` ${operator} `;
    relLines.push(`  ${source.name}${middle}${target.name} ${quoteDsl(title)}`);
  }
  if (relLines.length > 0) {
    lines.push('');
    lines.push(...relLines);
  }
  lines.push('}');
  lines.push('');

  // ── views ──────────────────────────────────────────────────────
  lines.push('views {');
  lines.push('  view index {');
  lines.push('    include *');
  lines.push('  }');
  lines.push('}');

  return lines.join('\n') + '\n';
}

export default toLikeC4;
