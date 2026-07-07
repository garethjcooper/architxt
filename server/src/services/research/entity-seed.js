/**
 * Research entity seeding — use verified architxt entities as the first pass
 * of entity extraction for the research agent.
 *
 * Loads local entities, scans the corpus of Hindsight fact content and the
 * synthesis text, and produces seed nodes + co-occurrence edges that the
 * inference layer can trust.
 */

import { listEntitiesForDetection } from '../../db/crud/entities.js';
import { scanForEntityMatches, groupMatchesByEntity } from '../../utils/entity-matcher.js';
import { createLogger } from '../../utils/logger.js';

const logger = createLogger('research-entity-seed');

/**
 * @param {Object} db
 * @param {Array<{statement: string, source_fact_ids?: string[]}>} findings
 * @param {string} [narrative]
 * @returns {Promise<{nodes: Object[], edges: Object[], sourceIds: string[]}>}
 */
export async function buildVerifiedEntitySeed(db, findings, narrative) {
  const entityResult = await listEntitiesForDetection(db);
  if (!entityResult.success || !entityResult.data?.length) {
    return { nodes: [], edges: [], sourceIds: [] };
  }

  const entities = entityResult.success ? entityResult.data : [];
  const corpusParts = [];
  if (narrative) corpusParts.push(narrative);
  for (const f of findings || []) {
    if (f.statement) corpusParts.push(f.statement);
  }
  const corpus = corpusParts.join('\n\n');

  const matches = scanForEntityMatches(entities, corpus);
  const grouped = groupMatchesByEntity(matches);

  const dbNameByEntityId = new Map();
  for (const e of entities) {
    if (e.entity_id) dbNameByEntityId.set(e.entity_id, e.name);
  }

  const entityById = new Map();
  for (const g of grouped.values()) {
    const canonicalName = dbNameByEntityId.get(g.entity_id) || g.name;
    entityById.set(g.entity_id, {
      id: g.entity_id,
      label: canonicalName,
      type: g.type_name,
      category: mapTypeName(g.type_name),
      mention_count: g.count,
      source: matches.some((m) => m.entity_id === g.entity_id && m.fromTag) ? 'canonical' : 'alias',
    });
  }

  const nodes = Array.from(entityById.values());

  logger.info('Built verified entity seed', {
    entityCount: nodes.length,
    tagHits: matches.filter((m) => m.fromTag).length,
    textHits: matches.filter((m) => !m.fromTag).length,
  });

  return {
    nodes,
    edges: [],
    sourceIds: nodes.map((n) => n.id),
    nameById: Object.fromEntries(entities.map((e) => [e.entity_id, e.name])),
  };
}

export function mapTypeName(typeName) {
  // Maps common English type names to a broad category. Short codes like
  // 'a-com' are passed through unchanged and colored individually in the UI.
  if (!typeName) return 'system';
  const lower = String(typeName).toLowerCase().replace(/\s+/g, ' ');
  if (lower.includes('database') || lower.includes('data store')) return 'database';
  if (lower.includes('queue') || lower.includes('message')) return 'queue';
  if (lower.includes('actor') || lower.includes('user') || lower.includes('role')) return 'actor';
  if (lower.includes('component') || lower.includes('module')) return 'component';
  if (lower.includes('service')) return 'service';
  if (lower.includes('system') || lower.includes('product') || lower.includes('platform')) return 'system';
  return 'system';
}
