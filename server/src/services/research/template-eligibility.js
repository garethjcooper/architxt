import { dbExec } from '../../utils/db-helpers.js';
import { substitutePlaceholders } from '../../db/crud/mental-models.js';
import { createLogger } from '../../utils/logger.js';

const logger = createLogger('template-eligibility');

/**
 * Find templates whose attached entities intersect the selected entity ids.
 *
 * For each template, return the matched entities and the derived ext_id that
 * would be used to fetch the instantiated mental model from Hindsight.
 *
 * @param {Object} db
 * @param {Object} options
 * @param {string[]} options.entities - entity ids (ent_entity_id) selected by the user
 * @returns {{success: true, templates: Array<object>} | {success: false, error: string, code: string}}
 */
export function findEligibleTemplateModels(db, { entities = [] } = {}) {
  return dbExec(() => {
    if (!Array.isArray(entities) || entities.length === 0) {
      return { success: false, error: 'entities must be a non-empty array', code: 'VALIDATION_ERROR' };
    }

    const placeholders = entities.map(() => '?').join(',');

    const sql = `
      SELECT
        m.mm_id AS template_id,
        m.mm_ext_id AS template_ext_id,
        m.mm_name AS template_name,
        e.ent_id AS id,
        e.ent_entity_id AS entity_id,
        e.ent_name AS name,
        et.et_type_name AS type_name
      FROM mental_models m
      JOIN mental_model_entities mme ON mme.mm_id = m.mm_id
      JOIN entities e ON e.ent_id = mme.ent_id
      JOIN entity_types et ON et.et_type_id = e.ent_type_id
      WHERE m.mm_is_template = 'true'
        AND e.ent_entity_id IN (${placeholders})
      ORDER BY m.mm_id, e.ent_entity_id
    `;

    const rows = db.prepare(sql).all(...entities);
    const byTemplate = new Map();

    for (const row of rows) {
      const key = row.template_id;
      let entry = byTemplate.get(key);
      if (!entry) {
        entry = {
          id: row.template_id,
          ext_id: row.template_ext_id,
          name: row.template_name,
          matched_entities: [],
        };
        byTemplate.set(key, entry);
      }

      const entity = {
        id: row.id,
        entity_id: row.entity_id,
        name: row.name,
        type_name: row.type_name,
      };

      entry.matched_entities.push({
        ...entity,
        derived_ext_id: substitutePlaceholders(row.template_ext_id, entity),
      });
    }

    const templates = Array.from(byTemplate.values());

    logger.info('Eligible template models computed', {
      selectedEntityCount: entities.length,
      matchedTemplateCount: templates.length,
    });

    return {
      success: true,
      templates,
    };
  }, 'templateEligibility.find');
}
