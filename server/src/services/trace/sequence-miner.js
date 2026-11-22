/**
 * Trace sequence miner.
 *
 * Takes parsed trace rows and a sequenceProfile, groups rows by correlation,
 * orders each group, derives a token signature per group, and emits a single
 * markdown document listing the distinct repeating sequences.
 *
 * No LLM involvement. Deterministic and reproducible for the same input.
 */

const DEFAULT_SEPARATOR = '$';
const DEFAULT_MISSING_VALUE = '-';

/**
 * @typedef {object} SequenceProfile
 * @property {string[]} orderColumns
 * @property {string[]} correlationColumns
 * @property {string[]} tokenColumns
 * @property {string} [separator]
 * @property {boolean} [includeTokenComponents]
 * @property {number} [maxExampleKeys]
 * @property {string} [sortOrder] - 'frequency-desc' | 'signature-asc' | 'none'
 * @property {boolean} [excludeMissingTokens] - exclude rows where the entity or direction value is missing (default true)
 * @property {string} entityColumn - single field treated as the entity (who/what acts); required, always the first column of the output table
 * @property {string} directionColumn - single field treated as the direction; required, always the second column of the output table
 * @property {number} [maxInputRows] - cap on input rows; excess down-sampled deterministically (0 = unlimited)
 * @property {number} [maxSignatures] - cap on distinct signatures; the rest fold into one overflow section (0 = unlimited, default 1000)
 * @property {number} [maxRowsPerGroup] - cap on rows retained per correlation group after ordering (0 = unlimited)
 * @property {number} [minSteps] - drop sequences with fewer steps than this (default 2; 1 keeps all)
 * @property {string} [missingValue] - placeholder rendered for missing token/entity/direction/correlation values (default "-")
 * @property {string} [outputFormat] - 'steps' (default) renders per-sequence step tables; 'graph' renders per-sequence edge tables (From/To/Type/Label/Support/Tokens) built from consecutive step pairs
 */

/**
 * @typedef {object} SequenceResult
 * @property {string} markdown
 * @property {SequenceStats} stats
 */

/**
 * @typedef {object} SequenceStats
 * @property {number} inputRows
 * @property {number} eligibleRows
 * @property {number} ineligibleRows
 * @property {number} sequenceCount
 * @property {number} correlationKeyCount
 * @property {boolean} [truncated] - true when maxInputRows down-sampled the input
 * @property {number} [truncatedRows] - rows dropped by maxInputRows
 * @property {number} [overflowSignatures] - signatures folded into the overflow bucket
 * @property {number} [cappedGroups] - correlation groups truncated by maxRowsPerGroup
 */

/**
 * @typedef {object} SequenceSection
 * @property {number} index
 * @property {string} signature
 * @property {number} frequency
 * @property {string[]} exampleKeys
 * @property {TokenStep[]} steps
 * @property {string[]} tokenColumns
 */

/**
 * @typedef {object} TokenStep
 * @property {number} step
 * @property {string} displayToken
 * @property {string} signatureToken
 * @property {Record<string, string>} components
 */

/**
 * @param {object[]} rows
 * @param {SequenceProfile} profile
 * @param {object} [options]
 * @param {string} [options.filename]
 * @param {string} [options.inputFormat]
 * @returns {SequenceResult}
 */
export function mineSequences(rows, profile, options = {}) {
  if (!Array.isArray(rows)) {
    throw new Error('rows must be an array');
  }
  const validated = validateProfile(profile);
  const {
    orderColumns,
    correlationColumns,
    tokenColumns,
    separator,
    includeTokenComponents,
    maxExampleKeys,
    sortOrder,
    excludeMissingTokens,
    entityColumn,
    directionColumn,
    maxInputRows,
    maxSignatures,
    maxRowsPerGroup,
    minSteps,
    missingValue,
    outputFormat,
    includeSequenceNumbers,
  } = validated;

  const filename = options.filename || 'trace-source';
  const inputFormat = options.inputFormat || 'trace';

  // maxInputRows: deterministic even-spread down-sample (same stride pattern as
  // sampleRowsForDiscovery) so repeated runs see identical representative rows.
  let truncated = false;
  let truncatedRows = 0;
  let workingRows = rows;
  if (maxInputRows > 0 && rows.length > maxInputRows) {
    truncated = true;
    truncatedRows = rows.length - maxInputRows;
    const picked = [];
    for (let i = 0; i < maxInputRows; i++) {
      picked.push(rows[Math.floor((i * rows.length) / maxInputRows)]);
    }
    workingRows = picked;
  }

  let eligibleRows = 0;
  let ineligibleRows = 0;
  let cappedGroups = 0;
  const groups = new Map(); // correlationKey -> { keyValues, rows: [] }

  for (const row of workingRows) {
    if (!row || typeof row !== 'object') {
      ineligibleRows += 1;
      continue;
    }

    const orderValues = orderColumns.map((col) => getColumnValue(row, col));
    if (orderValues.some((v) => v === undefined || v === null)) {
      ineligibleRows += 1;
      continue;
    }

    const correlationValues = correlationColumns.map((col) => getColumnValue(row, col));
    // Missing/blank correlation values do NOT make the row ineligible and do
    // NOT collapse into one missing-value bucket — a sparse id only correlates
    // when present. The group key is built from the present values only, so a
    // row missing a sparse id joins the group of the rows it does match.
    const presentPairs = correlationColumns
      .map((col, i) => ({ col, value: correlationValues[i] }))
      .filter(({ value }) => !(value === undefined || value === null || String(value) === missingValue || String(value).trim() === ''));
    // All correlation values missing: fall back to a single shared placeholder
    // group so the row is still mined rather than dropped or blobbed together
    // with unrelated rows.
    const keyValues = presentPairs.length > 0 ? presentPairs.map((p) => p.value) : [missingValue];

    // Exclude rows with missing entity/direction values (default ON): those
    // two fields are the mandatory context (what/action) — a row without them
    // can't form a contextually meaningful sequence step. Missing token
    // components are fine and render as the missing-value placeholder in the output.
    if (excludeMissingTokens) {
      const contextValues = [getColumnValue(row, entityColumn), getColumnValue(row, directionColumn)];
      if (contextValues.some((v) => v === undefined || v === null || String(v) === missingValue || String(v).trim() === '')) {
        ineligibleRows += 1;
        continue;
      }
    }

    eligibleRows += 1;
    const correlationKey = keyValues.map(normalizeToken).join(separator);
    if (!groups.has(correlationKey)) {
      groups.set(correlationKey, {
        keyValues,
        key: correlationKey,
        rows: [],
      });
    }
    groups.get(correlationKey).rows.push({ row, orderValues });
  }

  const signatures = new Map(); // signature -> { frequency, exampleKeys, steps }
  // Graph mode: raw ordered steps per correlation group, before any signature
  // merging — the graph is built from the seen flows, not from signatures.
  const flowGroups = []; // [{ keyValues, steps }]

  for (const group of groups.values()) {
    group.rows.sort((a, b) => compareOrderValues(a.orderValues, b.orderValues));

    // maxRowsPerGroup: after ordering, keep the first N rows of the group.
    // Order columns (timestamp etc.) mean the tail is the least recent.
    if (maxRowsPerGroup > 0 && group.rows.length > maxRowsPerGroup) {
      group.rows.length = maxRowsPerGroup;
      cappedGroups += 1;
    }

    const steps = group.rows.map(({ row }) => {
      const components = {};
      for (const col of tokenColumns) {
        const raw = getColumnValue(row, col);
        components[col] = raw === undefined || raw === null ? missingValue : String(raw);
      }
      const displayParts = tokenColumns.map((col) => components[col]);
      const signatureParts = tokenColumns.map((col) => normalizeToken(components[col]));
      const entity = entityColumn ? getColumnValue(row, entityColumn) : undefined;
      const direction = directionColumn ? getColumnValue(row, directionColumn) : undefined;
      return {
        displayToken: displayParts.join(':'),
        signatureToken: signatureParts.join(separator),
        components,
        entity: entity === undefined || entity === null ? missingValue : String(entity),
        direction: direction === undefined || direction === null ? missingValue : String(direction),
      };
    });

    if (outputFormat === 'graph') {
      // minSteps still applies: groups with fewer steps carry no flow.
      if (steps.length >= minSteps) {
        flowGroups.push({ keyValues: group.keyValues, steps });
      }
      continue;
    }

    const signature = steps.map((s) => s.signatureToken).join(separator);

    if (!signatures.has(signature)) {
      signatures.set(signature, {
        signature,
        frequency: 0,
        exampleKeys: [],
        steps,
        tokenColumns,
      });
    }
    const entry = signatures.get(signature);
    entry.frequency += 1;
    if (entry.exampleKeys.length < maxExampleKeys) {
      entry.exampleKeys.push(group.keyValues.join(separator));
    }
  }

  const sections = Array.from(signatures.values())
    .filter((entry) => entry.steps.length >= minSteps)
    .map((entry, index) => ({
      index: index + 1,
      ...entry,
    }));

  if (sortOrder === 'frequency-desc') {
    sections.sort((a, b) => {
      if (b.frequency !== a.frequency) return b.frequency - a.frequency;
      return a.signature.localeCompare(b.signature);
    });
  } else if (sortOrder === 'signature-asc') {
    sections.sort((a, b) => a.signature.localeCompare(b.signature));
  }
  // 'none' preserves insertion order.

  // maxSignatures: fold everything past the cap into a single overflow section
  // so the report stays bounded. Applied AFTER sorting so the kept sections
  // are the top-N by the configured sortOrder.
  let overflowSignatures = 0;
  let overflowSection = null;
  if (maxSignatures > 0 && sections.length > maxSignatures) {
    const kept = sections.slice(0, maxSignatures);
    const overflow = sections.slice(maxSignatures);
    overflowSignatures = overflow.length;
    overflowSection = {
      index: 0, // renumbered below
      signature: `…+${overflow.length} more signatures`,
      frequency: overflow.reduce((sum, s) => sum + s.frequency, 0),
      exampleKeys: [],
      steps: [],
      tokenColumns,
      overflow: true,
    };
    sections.length = 0;
    sections.push(...kept, overflowSection);
  }

  // Renumber sections after sorting so headings remain sequential.
  for (let i = 0; i < sections.length; i++) {
    sections[i].index = i + 1;
  }

  if (outputFormat === 'graph') {
    // Graph mode works from the raw ordered rows: every consecutive step pair
    // in every correlation group is one observed flow edge; edges are deduped
    // and split into connected components — one table per component, so no
    // row overlaps between tables (graphs, plural).
    const components = buildGraphComponents(flowGroups);
    const graphCount = components.length;
    const edgeCount = components.reduce((sum, c) => sum + c.edges.length, 0);
    const markdown = renderMarkdown({
      filename,
      inputFormat,
      orderColumns,
      correlationColumns,
      tokenColumns,
      entityColumn,
      directionColumn,
      outputFormat,
      includeSequenceNumbers,
      components,
      eligibleRows,
      ineligibleRows,
      truncated,
      truncatedRows,
      overflowSignatures,
      cappedGroups,
      minSteps,
    });
    return {
      markdown,
      stats: {
        inputRows: rows.length,
        eligibleRows,
        ineligibleRows,
        sequenceCount: graphCount,
        correlationKeyCount: groups.size,
        truncated,
        truncatedRows,
        overflowSignatures,
        cappedGroups,
        minSteps,
        ...(outputFormat === 'graph' ? { graphCount, edgeCount } : {}),
      },
    };
  }

  const markdown = renderMarkdown({
    filename,
    inputFormat,
    orderColumns,
    correlationColumns,
    tokenColumns,
    separator,
    includeTokenComponents,
    entityColumn,
    directionColumn,
    outputFormat,
    includeSequenceNumbers,
    sections,
    eligibleRows,
    ineligibleRows,
    truncated,
    truncatedRows,
    overflowSignatures,
    cappedGroups,
    minSteps,
  });

  return {
    markdown,
    stats: {
      inputRows: rows.length,
      eligibleRows,
      ineligibleRows,
      sequenceCount: sections.length,
      correlationKeyCount: groups.size,
      truncated,
      truncatedRows,
      overflowSignatures,
      cappedGroups,
      minSteps,
    },
  };
}

function validateProfile(profile) {
  if (!profile || typeof profile !== 'object') {
    throw new Error('sequenceProfile is required');
  }

  const orderColumns = asNonEmptyStringArray(profile.orderColumns, 'orderColumns');
  const correlationColumns = asNonEmptyStringArray(profile.correlationColumns, 'correlationColumns');
  const tokenColumns = asNonEmptyStringArray(profile.tokenColumns, 'tokenColumns');

  const rawSeparator = profile.separator;
  const separator = typeof rawSeparator === 'string' && rawSeparator.length > 0
    ? rawSeparator
    : DEFAULT_SEPARATOR;

  if (tokenColumns.some((col) => col.includes(separator))) {
    throw new Error(`tokenColumns cannot contain the separator "${separator}"`);
  }

  const includeTokenComponents = profile.includeTokenComponents !== false;
  const maxExampleKeys = normalizePositiveInteger(profile.maxExampleKeys, 5);
  const sortOrder = normalizeSortOrder(profile.sortOrder);
  // Default ON: rows whose entity/direction are missing are excluded — those
  // are the mandatory what/action context of the sequence.
  const excludeMissingTokens = profile.excludeMissingTokens !== false;
  // Mandatory: entity/direction are the what/action of a sequence — without
  // them the mined output loses its contextual sense.
  const entityColumn = normalizeRequiredColumn(profile.entityColumn, 'entityColumn');
  const directionColumn = normalizeRequiredColumn(profile.directionColumn, 'directionColumn');
  // Caps: 0/undefined means unlimited, except maxSignatures which defaults to
  // a bounded 1000 so pathological inputs still produce a finite report.
  const maxInputRows = normalizeCap(profile.maxInputRows, 0, 'maxInputRows');
  const maxSignatures = normalizeCap(profile.maxSignatures, 1000, 'maxSignatures');
  const maxRowsPerGroup = normalizeCap(profile.maxRowsPerGroup, 0, 'maxRowsPerGroup');
  // Default 2: sequences with fewer steps than this are dropped from the
  // report — single-step sequences are mostly noise (one-off actor/action).
  // Set to 1 to keep everything.
  const minSteps = normalizeCap(profile.minSteps, 2, 'minSteps');
  if (minSteps < 1) {
    throw new Error('minSteps must be at least 1');
  }
  // Placeholder for missing values; empty string is not allowed (it would
  // make missing values indistinguishable from blank and break grouping).
  const missingValue = typeof profile.missingValue === 'string' && profile.missingValue.length > 0
    ? profile.missingValue
    : DEFAULT_MISSING_VALUE;
  const outputFormat = normalizeOutputFormat(profile.outputFormat);
  // Default OFF: the ordinal is report position, not signal strength, so
  // headings carry only the descriptive name unless explicitly requested.
  const includeSequenceNumbers = profile.includeSequenceNumbers === true;

  return {
    orderColumns,
    correlationColumns,
    tokenColumns,
    separator,
    includeTokenComponents,
    maxExampleKeys,
    sortOrder,
    excludeMissingTokens,
    entityColumn,
    directionColumn,
    maxInputRows,
    maxSignatures,
    maxRowsPerGroup,
    minSteps,
    missingValue,
    outputFormat,
    includeSequenceNumbers,
  };
}

function normalizeOutputFormat(value) {
  if (!value) return 'steps';
  if (value === 'steps' || value === 'graph') return value;
  throw new Error('outputFormat must be one of: steps, graph');
}

function normalizeCap(value, defaultValue, name) {
  if (value === undefined || value === null) return defaultValue;
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0 || !Number.isInteger(n)) {
    throw new Error(`${name} must be a non-negative integer`);
  }
  return n;
}

function normalizeRequiredColumn(value, name) {
  if (value === undefined || value === null || value === '') {
    throw new Error(`${name} is required — tag one field as the ${name === 'entityColumn' ? 'entity' : 'direction'}`);
  }
  if (typeof value !== 'string') {
    throw new Error(`${name} must be a non-empty string when set`);
  }
  return value;
}

function asNonEmptyStringArray(value, name) {
  if (!Array.isArray(value) || value.length === 0) {
    throw new Error(`${name} must be a non-empty array of strings`);
  }
  if (!value.every((v) => typeof v === 'string' && v.length > 0)) {
    throw new Error(`${name} must contain only non-empty strings`);
  }
  return value;
}

function normalizePositiveInteger(value, defaultValue) {
  if (value === undefined || value === null) return defaultValue;
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0 || !Number.isInteger(n)) {
    throw new Error(`${value} is not a valid positive integer`);
  }
  return n;
}

function normalizeSortOrder(value) {
  if (!value) return 'none';
  if (['frequency-desc', 'signature-asc', 'none'].includes(value)) return value;
  throw new Error(`sortOrder must be one of: frequency-desc, signature-asc, none`);
}

function getColumnValue(row, column) {
  if (Object.prototype.hasOwnProperty.call(row, column)) {
    return row[column];
  }
  if (row.fields && Object.prototype.hasOwnProperty.call(row.fields, column)) {
    return row.fields[column];
  }
  return undefined;
}

function normalizeToken(value) {
  if (value === undefined || value === null) return '';
  return String(value)
    .toLowerCase()
    .trim()
    .replace(/\s+/g, ' ');
}

function compareOrderValues(aValues, bValues) {
  const len = Math.max(aValues.length, bValues.length);
  for (let i = 0; i < len; i++) {
    const a = aValues[i];
    const b = bValues[i];
    if (a === undefined) return -1;
    if (b === undefined) return 1;

    const aStr = String(a);
    const bStr = String(b);
    const aNum = parseNumeric(aStr);
    const bNum = parseNumeric(bStr);
    if (aNum !== null && bNum !== null) {
      if (aNum !== bNum) return aNum - bNum;
    }
    const cmp = aStr.localeCompare(bStr);
    if (cmp !== 0) return cmp;
  }
  return 0;
}

function parseNumeric(value) {
  if (value === '' || /^\s*$/.test(value)) return null;
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  return n;
}

function renderMarkdown({
  filename,
  inputFormat,
  orderColumns,
  correlationColumns,
  tokenColumns,
  separator,
  includeTokenComponents,
  entityColumn,
  directionColumn,
  outputFormat,
  includeSequenceNumbers,
  components,
  sections,
  eligibleRows,
  ineligibleRows,
  truncated,
  truncatedRows,
  overflowSignatures,
  cappedGroups,
  minSteps,
}) {
  const lines = [];

  lines.push(`# Trace Sequence Analysis: ${filename}`);
  lines.push('');
  lines.push(`**Input format**: \`${inputFormat}\``);
  lines.push(`**Order fields**: ${orderColumns.map((c) => `\`${c}\``).join(', ')}`);
  lines.push(`**Correlation fields**: ${correlationColumns.map((c) => `\`${c}\``).join(', ')}`);
  lines.push(`**Token fields**: ${tokenColumns.map((c) => `\`${c}\``).join(', ')}`);
  lines.push(`**Entity field**: \`${entityColumn}\``);
  lines.push(`**Direction field**: \`${directionColumn}\``);
  lines.push(`**Rows used**: ${eligibleRows}${ineligibleRows > 0 ? ` (${ineligibleRows} ineligible)` : ''}`);
  if (truncated) lines.push(`**Truncated**: yes — ${truncatedRows} input rows down-sampled away (maxInputRows)`);
  if (overflowSignatures > 0) lines.push(`**Overflow**: ${overflowSignatures} signatures folded into the last section (maxSignatures)`);
  if (cappedGroups > 0) lines.push(`**Capped groups**: ${cappedGroups} correlation group(s) truncated (maxRowsPerGroup)`);
  if (minSteps > 1) lines.push(`**Min steps**: ${minSteps} — shorter sequences omitted`);
  lines.push('');

  if (outputFormat === 'graph' && components) {
    // Graph mode: one table per connected component of the merged edge set.
    for (const component of components) {
      if (lines.length > 8) {
        lines.push('---');
        lines.push('');
      }
      const nodeList = [...component.nodes].sort((a, b) => a.localeCompare(b));
      lines.push(`## ${includeSequenceNumbers ? `Graph ${component.index} — ` : ''}${nodeList.length} nodes, ${component.edges.length} edge${component.edges.length !== 1 ? 's' : ''}`);
      lines.push('');
      lines.push('Nodes:');
      lines.push('');
      lines.push('| Node |');
      lines.push('|---|');
      for (const n of nodeList) {
        lines.push(`| ${n.replace(/\|/g, '\\|')} |`);
      }
      lines.push('');
      lines.push('Edges:');
      lines.push('');
      renderGraphTable(lines, component.edges, tokenColumns);
      lines.push('');
    }
  } else {
  for (const section of sections) {
    if (lines.length > 8) {
      lines.push('---');
      lines.push('');
    }

    if (section.overflow) {
      lines.push(`## ${includeSequenceNumbers ? `Sequence ${section.index} — ` : ''}\`${section.signature}\``);
      lines.push('');
      lines.push(`- **Frequency**: ${section.frequency} trace${section.frequency !== 1 ? 's' : ''} (combined)`);
      lines.push('');
      continue;
    }

    const displaySignature = section.steps.map((s) => s.displayToken).join(` ${separator} `);
    lines.push(`## ${includeSequenceNumbers ? `Sequence ${section.index} — ` : ''}${describeSequence(section)}`);
    lines.push('');
    lines.push(`- **Signature**: \`${displaySignature}\``);
    lines.push(`- **Frequency**: ${section.frequency} trace${section.frequency !== 1 ? 's' : ''}`);
    lines.push(`- **Example trace keys**: ${section.exampleKeys.map((k) => `\`${k}\``).join(', ')}`);
    lines.push('');

    renderStepTable(lines, section, tokenColumns, includeTokenComponents);

    lines.push('');
  }
  }

  return lines.join('\n');
}

function capitalizeHeader(column) {
  return column
    .replace(/([A-Z])/g, ' $1')
    .replace(/^./, (c) => c.toUpperCase())
    .trim();
}

/**
 * Derive a short human-readable name for a sequence from its entity flow:
 * consecutive distinct entities joined with "→" (repeats collapsed, so a
 * self-loop A→A→B reads "A → B"). Capped at 6 hops; longer flows end with "…".
 * Deterministic — same steps, same name.
 */
function describeSequence(section) {
  const MAX_HOPS = 6;
  const entities = [];
  for (const step of section.steps) {
    if (entities[entities.length - 1] !== step.entity) entities.push(step.entity);
  }
  const shown = entities.slice(0, MAX_HOPS);
  const suffix = entities.length > MAX_HOPS ? ' → …' : '';
  return `${shown.join(' → ')}${suffix}`;
}

/**
 * Step-table renderer (default "Sequence Steps" output). Entity and Direction
 * are standard fields: they always lead the table, ahead of the token and the
 * (optional) token components.
 */
function renderStepTable(lines, section, tokenColumns, includeTokenComponents) {
  const headerCols = ['Step', 'Entity', 'Direction', 'Token'];
  if (includeTokenComponents) {
    headerCols.push(...tokenColumns.map((col) => capitalizeHeader(col)));
  }
  lines.push(`| ${headerCols.join(' | ')} |`);
  lines.push(`|${headerCols.map(() => '---').join('|')}|`);

  for (let i = 0; i < section.steps.length; i++) {
    const step = section.steps[i];
    const rowCols = [String(i + 1), step.entity, step.direction, `\`${step.displayToken}\``];
    if (includeTokenComponents) {
      rowCols.push(...tokenColumns.map((col) => step.components[col]));
    }
    lines.push(`| ${rowCols.join(' | ')} |`);
  }
}

/**
 * Build the connected components of the observed flow graph from raw ordered
 * rows. Every consecutive step pair in every correlation group is one observed
 * flow; distinct edges (from|to|type|label) are deduped with support = the
 * number of times the pair was seen. Components are sets of edges linked
 * through shared entity nodes, so no edge row appears in more than one
 * component table.
 *
 * @param {Array<{ keyValues: string[], steps: TokenStep[] }>} flowGroups
 * @returns {Array<{ index: number, nodes: Set<string>, edges: Array<{from,to,type,label,support,components}> }>}
 */
function buildGraphComponents(flowGroups) {
  const edgeMap = new Map(); // key -> { from, to, type, label, support, components }
  for (const group of flowGroups) {
    for (let i = 0; i + 1 < group.steps.length; i++) {
      const from = group.steps[i];
      const to = group.steps[i + 1];
      const edgeKey = `${from.entity}\x00${to.entity}\x00${from.direction}\x00${from.displayToken}`;
      if (!edgeMap.has(edgeKey)) {
        edgeMap.set(edgeKey, { from: from.entity, to: to.entity, type: from.direction, label: from.displayToken, support: 0, components: from.components });
      }
      edgeMap.get(edgeKey).support += 1;
    }
  }

  const edges = Array.from(edgeMap.values());

  // Union-find over entity nodes.
  const parent = new Map();
  const find = (node) => {
    if (!parent.has(node)) parent.set(node, node);
    let root = parent.get(node);
    while (root !== parent.get(root)) root = parent.get(root);
    // path compression
    let cur = node;
    while (parent.get(cur) !== root) {
      const next = parent.get(cur);
      parent.set(cur, root);
      cur = next;
    }
    return root;
  };
  const union = (a, b) => { parent.set(find(a), find(b)); };
  for (const e of edges) union(e.from, e.to);

  const byRoot = new Map();
  for (const e of edges) {
    const root = find(e.from);
    if (!byRoot.has(root)) byRoot.set(root, { nodes: new Set(), edges: [] });
    byRoot.get(root).nodes.add(e.from).add(e.to);
    byRoot.get(root).edges.push(e);
  }

  const components = Array.from(byRoot.values()).map((c) => ({
    nodes: c.nodes,
    edges: c.edges.sort((a, b) =>
      a.from.localeCompare(b.from) || a.to.localeCompare(b.to) || a.type.localeCompare(b.type) || a.label.localeCompare(b.label)),
  }));
  // Deterministic order: largest component first, then by smallest node id.
  const minNode = (c) => Array.from(c.nodes).sort((a, b) => a.localeCompare(b))[0];
  components.sort((a, b) =>
    b.edges.length - a.edges.length ||
    minNode(a).localeCompare(minNode(b)));
  components.forEach((c, i) => { c.index = i + 1; });
  return components;
}

/**
 * Graph-table renderer ("Sequence Graph" output). Renders one edges table in
 * the layout of the standard edge-context tables: From | To | Type | Label |
 * Support, plus one column per token field (like the steps tables), showing
 * the leaving step's token components. One table is rendered per connected
 * component, so the report is a set of disconnected small graphs, never one
 * connected graph.
 */
function renderGraphTable(lines, edges, tokenColumns) {
  // Pipes inside a table cell break GFM table parsing even inside code spans,
  // so escape them in every cell value.
  const cell = (value) => String(value).replace(/\|/g, '\\|');

  const headerCols = ['From', 'To', 'Type', 'Label', 'Support', ...tokenColumns.map((col) => capitalizeHeader(col))];
  lines.push(`| ${headerCols.join(' | ')} |`);
  lines.push(`|${headerCols.map(() => '---').join('|')}|`);

  for (const e of edges) {
    const rowCols = [cell(e.from), cell(e.to), cell(e.type), `\`${cell(e.label)}\``, String(e.support)];
    rowCols.push(...tokenColumns.map((col) => cell(e.components[col] ?? '')));
    lines.push(`| ${rowCols.join(' | ')} |`);
  }
}
