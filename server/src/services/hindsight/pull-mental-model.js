/**
 * Hindsight Pull Service - Mental Models
 *
 * Pulls mental models from a Hindsight bank into architxt.
 *
 * Design notes:
 * - Plain models are keyed in mental_models by mm_ext_id (the Hindsight id).
 * - Derived instances are an architxt-only concept. They do NOT have their own
 *   mental_models row. Their effective config is template config + per-entity
 *   overrides stored in mental_model_entities. Pulling a derived row therefore
 *   updates only those overrides.
 * - The UI sends explicit pull targets with hind_id (actual Hindsight model id),
 *   because derived diff rows use a substituted ext_id that differs from the
 *   underlying Hindsight id.
 */

import { createLogger } from '../../utils/logger.js';
import { db } from '../../db/connection.js';
import { createTag } from '../../db/crud/tags.js';
import {
  createMentalModel,
  updateMentalModel,
  getMentalModelWithRelations,
  updateMentalModelEntityOverrides,
  normaliseRefreshMode,
  normaliseTagsMatchMode,
  normaliseMaxTokens,
  toDbBool,
  DEFAULT_MAX_TOKENS,
  DEFAULT_REFRESH_MODE,
  DEFAULT_TAGS_MATCH_MODE,
} from '../../db/crud/mental-models.js';
import { listMentalModels } from './mental-models.js';

const logger = createLogger('hindsight-mental-model-pull');

function toDbStringOrNull(value) {
  return value === null || value === undefined ? null : String(value);
}

/**
 * Map a Hindsight mental model (detail=content or full) to architxt DB fields.
 */
function mapHindsightToDbModel(h) {
  return {
    mm_ext_id: h.id,
    mm_name: toDbStringOrNull(h.name),
    mm_source_query: toDbStringOrNull(h.source_query),
    mm_max_tokens: normaliseMaxTokens(h.max_tokens) ?? DEFAULT_MAX_TOKENS,
    mm_refresh_mode: normaliseRefreshMode(h.trigger?.mode) ?? DEFAULT_REFRESH_MODE,
    mm_refresh_after_consolidation: toDbBool(h.trigger?.refresh_after_consolidation === true),
    mm_exclude_all_mental_models: toDbBool(h.trigger?.exclude_mental_models === true),
    mm_exclude_mental_model_list: Array.isArray(h.trigger?.exclude_mental_model_ids)
      ? h.trigger.exclude_mental_model_ids.join(',')
      : null,
    mm_tags_match_mode: normaliseTagsMatchMode(h.trigger?.tags_match) ?? DEFAULT_TAGS_MATCH_MODE,
    mm_is_template: 'false',
  };
}

/**
 * Resolve or create a tag by name. Returns the tag_id, or null if creation fails.
 */
function resolveTagId(tagName) {
  const existing = db.prepare('SELECT tag_id FROM tags WHERE tag_name = ?').get(tagName);
  if (existing) return existing.tag_id;

  const result = createTag(db, {
    tag_name: tagName,
    tag_generated_by: 'import',
  });
  if (!result.success) {
    logger.warn('resolveTagId: tag creation failed', { tagName, error: result.error });
    return null;
  }
  return result.data;
}

/**
 * Replace all tag relationships for a mental model with the given tag names.
 */
function syncMentalModelTags(mmId, tagNames) {
  db.prepare('DELETE FROM mental_model_tags WHERE mm_id = ?').run(mmId);

  if (!tagNames || tagNames.length === 0) return;

  const insert = db.prepare('INSERT OR IGNORE INTO mental_model_tags (mm_id, tag_id) VALUES (?, ?)');
  for (const tagName of tagNames) {
    const tagId = resolveTagId(tagName);
    if (tagId != null) {
      insert.run(mmId, tagId);
    }
  }
}

/**
 * Pull a single plain mental model from Hindsight into architxt.
 * Either updates an existing row by mm_ext_id or creates a new one.
 */
async function pullPlainMentalModel(hindModel) {
  const extId = hindModel.id;
  logger.info('Pulling plain mental model', { extId });

  const existingRow = db.prepare('SELECT mm_id FROM mental_models WHERE mm_ext_id = ?').get(extId);

  if (existingRow) {
    logger.info('Updating existing plain mental model', { mmId: existingRow.mm_id, extId });
    const dbData = mapHindsightToDbModel(hindModel);
    delete dbData.mm_ext_id;

    const updateResult = updateMentalModel(db, existingRow.mm_id, dbData);
    if (!updateResult.success) {
      throw new Error(`update failed: ${updateResult.error}`);
    }

    syncMentalModelTags(existingRow.mm_id, hindModel.tags || []);

    const refreshed = await getMentalModelWithRelations(db, existingRow.mm_id);
    return { created: false, model: refreshed.success ? refreshed.data : null };
  }

  logger.info('Creating new plain mental model', { extId });
  const dbData = mapHindsightToDbModel(hindModel);
  const createResult = createMentalModel(db, dbData);
  if (!createResult.success) {
    throw new Error(`create failed: ${createResult.error}`);
  }

  const newId = createResult.data;
  syncMentalModelTags(newId, hindModel.tags || []);

  const refreshed = await getMentalModelWithRelations(db, newId);
  return { created: true, model: refreshed.success ? refreshed.data : null };
}

/**
 * Pull a single derived mental model from Hindsight into architxt.
 * Derived rows only update per-entity overrides in mental_model_entities.
 */
async function pullDerivedMentalModel(hindModel, target) {
  const { mm_id: mmId, id: entId } = target.derived_entity || {};

  if (!mmId || !entId) {
    throw new Error(`derived target requires derived_entity.mm_id and derived_entity.id (ext_id=${target.ext_id})`);
  }

  logger.info('Updating derived mental model overrides', {
    extId: target.ext_id,
    hindId: hindModel.id,
    mmId,
    entId,
  });

  const overrides = {
    refresh_mode: normaliseRefreshMode(hindModel.trigger?.mode) ?? DEFAULT_REFRESH_MODE,
    refresh_after_consolidation: hindModel.trigger?.refresh_after_consolidation === true,
    exclude_all_mental_models: hindModel.trigger?.exclude_mental_models === true,
    max_tokens: normaliseMaxTokens(hindModel.max_tokens),
  };

  logger.info('Derived override values from Hindsight', {
    extId: target.ext_id,
    hindId: hindModel.id,
    mmId,
    entId,
    overrides,
  });

  const updateResult = updateMentalModelEntityOverrides(db, mmId, entId, overrides);
  if (!updateResult.success) {
    throw new Error(`override update failed: ${updateResult.error}`);
  }
  if (!updateResult.data.changed) {
    logger.info('Derived overrides already in sync', {
      extId: target.ext_id,
      mmId,
      entId,
      current: updateResult.data.row,
      overrides,
    });

    const refreshed = await getMentalModelWithRelations(db, mmId);
    return { alreadyInSync: true, model: refreshed.success ? refreshed.data : null };
  }

  logger.info('Derived overrides updated', {
    extId: target.ext_id,
    mmId,
    entId,
    previous: updateResult.data.row,
    overrides,
  });

  const refreshed = await getMentalModelWithRelations(db, mmId);
  return { created: false, model: refreshed.success ? refreshed.data : null };
}

/**
 * Pull one or more mental models from Hindsight into architxt.
 *
 * @param {number} serverId
 * @param {string} bankId
 * @param {Array<{ext_id: string, hind_id: string, is_derived: boolean, derived_entity?: {mm_id: number, id: number}}>} [targets]
 *   Explicit targets from the UI. If omitted, pulls all Hindsight-only plain models.
 * @returns {Promise<{success: boolean, created?: number, updated?: number, errors?: string[]}>}
 */
export async function pullMentalModels(serverId, bankId, targets = []) {
  logger.info('Pulling mental models', { serverId, bankId, targetCount: targets.length });

  // Fetch Hindsight list once. We need it both for explicit targets (lookup)
  // and for the fallback "pull all" path.
  const listResult = await listMentalModels(serverId, bankId, { limit: 1000, detail: 'content' });
  if (!listResult.success) {
    return { success: false, errors: [listResult.error] };
  }

  const hindById = new Map();
  for (const mm of listResult.mentalModels || []) {
    if (mm.id) {
      hindById.set(mm.id, mm);
    }
  }

  let work = [];

  if (targets.length > 0) {
    // Validate and resolve explicit targets.
    for (const target of targets) {
      if (!target.hind_id) {
        return { success: false, errors: [`target ${target.ext_id}: hind_id is required`] };
      }
      const hindModel = hindById.get(target.hind_id);
      if (!hindModel) {
        return { success: false, errors: [`target ${target.ext_id}: Hindsight model ${target.hind_id} not found`] };
      }
      work.push({ hindModel, target });
    }
  } else {
    // No explicit targets: pull all Hindsight plain models.
    // Derived targets cannot be pulled without template/entity metadata.
    for (const hindModel of hindById.values()) {
      work.push({
        hindModel,
        target: { ext_id: hindModel.id, hind_id: hindModel.id, is_derived: false },
      });
    }
  }

  let created = 0;
  let updated = 0;
  let inSync = 0;
  const errors = [];

  for (const { hindModel, target } of work) {
    try {
      let result;
      if (target.is_derived === true) {
        result = await pullDerivedMentalModel(hindModel, target);
      } else {
        result = await pullPlainMentalModel(hindModel);
      }
      if (result.created) created++;
      else if (result.alreadyInSync) inSync++;
      else updated++;
    } catch (err) {
      errors.push(`${target.ext_id}: ${err.message}`);
    }
  }

  return { success: errors.length === 0, created, updated, inSync, errors };
}
