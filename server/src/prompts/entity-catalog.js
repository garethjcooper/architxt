import { listEntitiesWithType } from '../db/crud/entities.js';

/**
 * Build the canonical entity catalog used in prompt templates.
 *
 * @param {object} db
 * @returns {Promise<Array<{id: string, type: string, name: string, description: string, aliases: string[]}>>}
 */
export async function loadEntityCatalog(db) {
  const result = await listEntitiesWithType(db);
  if (!result || !result.success) {
    throw new Error(result?.error || 'Failed to load entity catalog');
  }
  const rows = result.data || [];
  return rows.map((r) => ({
    id: r.ent_entity_id,
    type: r.et_type_name,
    name: r.ent_name,
    description: r.ent_description || '',
    aliases: Array.isArray(r.ent_aliases) ? r.ent_aliases : [],
  }));
}

/**
 * Format the entity catalog as Markdown for injection into a prompt.
 *
 * @param {Array<{id: string, type: string, name: string, description: string, aliases: string[]}>} entities
 * @returns {string}
 */
export function formatEntityCatalog(entities) {
  if (!Array.isArray(entities) || entities.length === 0) {
    return 'No entities defined.';
  }

  const lines = entities.map((e) => {
    const aliasPart = e.aliases.length > 0 ? ` (aliases: ${e.aliases.join(', ')})` : '';
    const displayName = e.name.replace(/[()[\]{}]/g, '');
    return `- ${displayName} (${e.type}:${e.id})${aliasPart}`;
  });

  return `### Entity catalog\n\n${lines.join('\n')}`;
}

/**
 * Convenience: build the ARCHITXT_ENTITIES variable value from the database.
 *
 * @param {object} db
 * @returns {Promise<string>}
 */
export async function buildEntityCatalogVariable(db) {
  const entities = await loadEntityCatalog(db);
  return formatEntityCatalog(entities);
}
