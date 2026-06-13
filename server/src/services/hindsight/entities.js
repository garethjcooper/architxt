/**
 * Hindsight Entity Sync Service
 *
 * Push / pull entity labels (type === 'map') between architxt and Hindsight.
 * Hindsight stores entity labels in bank config:
 *   PATCH {serviceUrl}/v1/default/banks/{bank_id}/config
 *   { updates: { entity_labels: [...] } }
 *
 * Label shape (type === 'map'):
 *   {
 *     key:   type_name  (e.g. "Application Component")
 *     type:  "map",
 *     description?: string,
 *     fields: {
 *       id:   { values: [{ value: entity_id }, …] },
 *       name: { values: [{ value: name }, …] }
 *     }
 *   }
 */

import { createLogger } from '../../utils/logger.js';
import { getServerConfig } from './config.js';
import { getBankConfig } from './bank-config.js';
import { db } from '../../db/connection.js';
import {
  createEntityType,
  listEntityTypes,
} from '../../db/crud/entity-types.js';
import {
  createEntity,
  updateEntity,
  deleteEntity,
} from '../../db/crud/entities.js';

const logger = createLogger('hindsight-entity-sync');

function buildHeaders(serverConfig) {
  const headers = { 'Content-Type': 'application/json' };
  if (serverConfig.apiKey) {
    headers['Authorization'] = `Bearer ${serverConfig.apiKey}`;
  }
  return headers;
}

/* ═══════════════════════════════════════════
   Helpers
   ═══════════════════════════════════════════ */

/**
 * Build Hindsight entity_labels array from all architxt entities.
 * Each label is a flat multi-values list: value = entity id, description = entity name.
 */
function buildMapLabelsFromArchitxt() {
  const rows = db.prepare(`
    SELECT e.ent_entity_id, e.ent_name, et.et_type_name, et.et_description
    FROM entities e
    JOIN entity_types et ON e.ent_type_id = et.et_id
    ORDER BY et.et_type_name, e.ent_entity_id
  `).all();

  const byType = new Map();
  for (const row of rows) {
    const tn = row.et_type_name;
    if (!byType.has(tn)) {
      byType.set(tn, {
        description: row.et_description || '',
        entries: [], // { id, name }
      });
    }
    byType.get(tn).entries.push({ id: row.ent_entity_id, name: row.ent_name });
  }

  const labels = [];

  for (const [typeName, data] of byType) {
    labels.push({
      key: typeName,
      tag: true,
      type: 'multi-values',
      description: data.description || typeName,
      values: data.entries.map((e) => ({ value: e.id, description: e.name || '' })),
      optional: true,
    });
  }

  return labels;
}

/**
 * Merge new map labels with existing non-map labels from Hindsight config.
 * If typeNames is provided, only those types are refreshed from architxt;
 * existing Hindsight map labels for other types are preserved.
 */
async function mergeAndPushLabels(serverId, bankId, newMapLabels, typeNames) {
  const configResult = await getBankConfig(serverId, bankId);
  if (!configResult.success) {
    return { success: false, error: `Cannot fetch current config: ${configResult.error}` };
  }

  const existingLabels = configResult.config?.config?.entity_labels || [];
  const nonMapLabels = Array.isArray(existingLabels)
    ? existingLabels.filter((l) => l.type !== 'multi-values')
    : [];

  // Preserve existing multi-values labels that are NOT being updated in this push
  const existingMapLabels = Array.isArray(existingLabels)
    ? existingLabels.filter((l) => l.type === 'multi-values')
    : [];

  const newKeys = new Set(newMapLabels.map((l) => l.key));
  const preservedMapLabels = Array.isArray(typeNames) && typeNames.length > 0
    ? existingMapLabels.filter((l) => !newKeys.has(l.key))
    : [];

  const entityLabels = [...nonMapLabels, ...preservedMapLabels, ...newMapLabels];

  const serverConfig = await getServerConfig(serverId);
  if (!serverConfig.success) {
    return { success: false, error: serverConfig.error };
  }

  const { serviceUrl } = serverConfig.config;
  const url = `${serviceUrl}/v1/default/banks/${encodeURIComponent(bankId)}/config`;

  try {
    const response = await fetch(url, {
      method: 'PATCH',
      headers: buildHeaders(serverConfig.config),
      body: JSON.stringify({ updates: { entity_labels: entityLabels } }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      logger.error('Hindsight entity push failed', { serverId, bankId, status: response.status, error: errorText });
      return { success: false, error: `HTTP ${response.status}: ${errorText}` };
    }

    logger.info('Hindsight entity push OK', { serverId, bankId, mapLabels: newMapLabels.length, preserved: preservedMapLabels.length });
    return { success: true, mapLabelsPushed: newMapLabels.length };
  } catch (err) {
    logger.error('Hindsight entity push error', { serverId, bankId, error: err.message });
    return { success: false, error: err.message };
  }
}

/**
 * Internal: pull given multi-values labels into architxt.
 * Creates/updates entities to match Hindsight, and optionally deletes
 * architxt entities not present in the pulled labels (for types being processed).
 */
function pullMapLabelsIntoArchitxt(mapLabels, opts = {}) {
  const { deleteMissing = false } = opts;

  const existingTypesResult = listEntityTypes(db, { orderBy: 'et_type_name' });
  const typeNameToId = new Map();
  if (existingTypesResult.success) {
    for (const row of existingTypesResult.data) {
      typeNameToId.set(row.et_type_name, row.et_id);
    }
  }

  const existingEntities = db.prepare(`
    SELECT e.ent_id, e.ent_entity_id, e.ent_name, e.ent_description, et.et_type_name
    FROM entities e
    JOIN entity_types et ON e.ent_type_id = et.et_id
  `).all();

  const entityKeyToId = new Map();
  for (const row of existingEntities) {
    entityKeyToId.set(`${row.et_type_name}:${row.ent_entity_id}`, row.ent_id);
  }

  let createdTypes = 0;
  let createdEntities = 0;
  let updatedEntities = 0;

  // Build expected keys from Hindsight labels
  const expectedKeys = new Set();
  for (const label of mapLabels) {
    const typeName = label.key;
    const values = Array.isArray(label.values) ? label.values : [];
    for (const v of values) {
      if (v.value) expectedKeys.add(`${typeName}:${v.value}`);
    }
  }

  for (const label of mapLabels) {
    const typeName = label.key;
    const values = Array.isArray(label.values) ? label.values : [];

    let typeId = typeNameToId.get(typeName);
    if (!typeId) {
      const createResult = createEntityType(db, {
        type_name: typeName,
        description: label.description || typeName,
      });
      if (!createResult.success) {
        logger.warn('pullMapLabels: type creation failed', { typeName, error: createResult.error });
        continue;
      }
      typeId = createResult.data;
      typeNameToId.set(typeName, typeId);
      createdTypes++;
    }

    for (const v of values) {
      const entityId = v.value;
      const name = v.description;
      const key = `${typeName}:${entityId}`;
      const existingEntId = entityKeyToId.get(key);

      if (existingEntId) {
        const current = existingEntities.find((e) => e.ent_id === existingEntId);
        // Only update name if Hindsight explicitly provided one
        if (current && name !== undefined && current.ent_name !== name) {
          const upd = updateEntity(db, existingEntId, { name });
          if (upd.success) updatedEntities++;
        }
      } else {
        const createResult = createEntity(db, {
          type_id: typeId,
          entity_id: entityId,
          name: name !== undefined ? name : entityId,
          description: label.description || '',
          generated_by: 'import',
        });
        if (createResult.success) {
          createdEntities++;
          entityKeyToId.set(key, createResult.data);
        } else {
          logger.warn('pullMapLabels: entity creation failed', { typeName, entityId, error: createResult.error });
        }
      }
    }
  }

  // ── Delete missing entities (only for types being pulled) ──
  let deletedEntities = 0;
  if (deleteMissing) {
    const pulledTypeNames = new Set(mapLabels.map((l) => l.key));
    for (const row of existingEntities) {
      const key = `${row.et_type_name}:${row.ent_entity_id}`;
      if (pulledTypeNames.has(row.et_type_name) && !expectedKeys.has(key)) {
        try {
          deleteEntity(db, row.ent_id);
          deletedEntities++;
          entityKeyToId.delete(key);
        } catch (delErr) {
          logger.warn('pullMapLabels: entity deletion failed', { key, ent_id: row.ent_id, error: delErr.message });
        }
      }
    }
  }

  return { createdTypes, createdEntities, updatedEntities, deletedEntities };
}

/* ═══════════════════════════════════════════
   Public API
   ═══════════════════════════════════════════ */

/**
 * Push all architxt entities (grouped by type) to Hindsight as map labels.
 * Non-map labels already on Hindsight are preserved.
 */
export async function pushEntities(serverId, bankId) {
  logger.info('Pushing entities to Hindsight', { serverId, bankId });
  const mapLabels = buildMapLabelsFromArchitxt();
  return mergeAndPushLabels(serverId, bankId, mapLabels);
}

/**
 * Push selected types only.
 */
export async function pushEntityTypes(serverId, bankId, typeNames) {
  logger.info('Pushing selected entity types to Hindsight', { serverId, bankId, typeNames });
  if (!typeNames || typeNames.length === 0) {
    return { success: false, error: 'No types selected' };
  }

  const allMapLabels = buildMapLabelsFromArchitxt();
  const selectedLabels = allMapLabels.filter((l) => typeNames.includes(l.key));

  if (selectedLabels.length === 0) {
    return { success: false, error: 'Selected types not found in architxt' };
  }

  return mergeAndPushLabels(serverId, bankId, selectedLabels, typeNames);
}

/**
 * Pull all map-type entity labels from Hindsight into architxt.
 */
export async function pullEntities(serverId, bankId) {
  logger.info('Pulling entities from Hindsight', { serverId, bankId });

  const configResult = await getBankConfig(serverId, bankId);
  if (!configResult.success) {
    return { success: false, error: configResult.error };
  }

  const rawLabels = configResult.config?.config?.entity_labels || [];
  const mapLabels = Array.isArray(rawLabels)
    ? rawLabels.filter((l) => l.type === 'multi-values')
    : [];

  const stats = pullMapLabelsIntoArchitxt(mapLabels, { deleteMissing: false });

  logger.info('pullEntities complete', { serverId, bankId, ...stats });
  return { success: true, ...stats };
}

/**
 * Pull selected types only.
 */
export async function pullEntityTypes(serverId, bankId, typeNames) {
  logger.info('Pulling selected entity types from Hindsight', { serverId, bankId, typeNames });
  if (!typeNames || typeNames.length === 0) {
    return { success: false, error: 'No types selected' };
  }

  const configResult = await getBankConfig(serverId, bankId);
  if (!configResult.success) {
    return { success: false, error: configResult.error };
  }

  const rawLabels = configResult.config?.config?.entity_labels || [];
  const mapLabels = Array.isArray(rawLabels)
    ? rawLabels.filter((l) => l.type === 'multi-values' && typeNames.includes(l.key))
    : [];

  if (mapLabels.length === 0) {
    return { success: false, error: 'Selected types not found in Hindsight' };
  }

  const stats = pullMapLabelsIntoArchitxt(mapLabels, { deleteMissing: true });

  logger.info('pullEntityTypes complete', { serverId, bankId, ...stats });
  return { success: true, ...stats };
}
