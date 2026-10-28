import { listEdgeTypes } from '../db/crud/edge-types.js';

/**
 * Build the dynamic edge/relationship vocabulary fragment from the live
 * `edge_types` registry. This is the value that will be injected as the
 * {{ARCHITXT_EDGE_VOCABULARY}} variable (and replaces the static
 * edge-vocabulary.md fragment).
 *
 * @param {object} db
 * @returns {string} Markdown fragment.
 */
export function buildEdgeVocabularyFragment(db) {
  const rows = db.prepare(`
    SELECT edt_type_name, edt_description
    FROM edge_types
    ORDER BY edt_type_name ASC
  `).all();

  if (!rows || rows.length === 0) {
    return '';
  }
  const lines = [
    '### Edge/Relationship vocabulary',
    '',
    'Use only these edge types. Direction is implicit: each type is expressed from the `from` node toward the `to` node.',
    '',
    '| Edge type | Direction | Meaning |',
    '|---|---|---|',
  ];

  for (const row of rows) {
    const typeName = row.edt_type_name;
    const description = (row.edt_description || '').replace(/\n/g, ' ').trim();
    lines.push(`| \`${typeName}\` | \`from\` → \`to\` | ${description} |`);
  }

  lines.push(
    '',
    'Rules:',
    '- Do not prefix edge types with any node-state marker.',
    '- For bidirectional relationships, use the most specific type and a label like "bidirectional sync".',
    '- If an old source describes "A receives from B", express it as `B sends A`.',
    '- Every edge `from` and `to` must be a node id that appears in the `nodes` list.'
  );

  return lines.join('\n');
}
