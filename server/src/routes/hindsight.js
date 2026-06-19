import { Router } from 'express';
import { listDocuments as hindsightListDocuments } from '../services/hindsight/documents.js';
import { getDocument as hindsightGetDocument } from '../services/hindsight/documents.js';
import { pullDocument } from '../services/hindsight/pull.js';
import { pushDocument } from '../services/hindsight/push.js';
import { pushEntities, pushEntityTypes, pullEntities, pullEntityTypes } from '../services/hindsight/entities.js';
import { listMentalModels as hindsightListMentalModels } from '../services/hindsight/mental-models.js';
import { listDirectives as hindsightListDirectives } from '../services/hindsight/directives.js';
import { pushDirective as pushHindsightDirective } from '../services/hindsight/push-directive.js';
import { pullDirective as pullHindsightDirective } from '../services/hindsight/pull-directive.js';
import { pushMentalModel, createMentalModel } from '../services/hindsight/push-mental-model.js';
import { pullMentalModels } from '../services/hindsight/pull-mental-model.js';
import { getBankConfig } from '../services/hindsight/bank-config.js';
import { db } from '../db/connection.js';
import { createLogger } from '../utils/logger.js';
import { getExpandedDocumentMetadata } from '../db/crud/document-metadata.js';
import {
  listPendingByServerBank,
  dismissPendingOperation,
  listAllPending,
} from '../db/crud/pending-operations.js';
import { getSyncedFields } from '../entity-tag-format.js';
import { getAllEntitiesWithTypes } from '../db/crud/entities.js';
import { getDocumentsForDiff, getDocumentByExtId, getAllDocumentContexts } from '../db/crud/documents.js';
import { getAllDocumentTags, getDocumentTagsByDocId } from '../db/crud/document-tags.js';
import { getContextDescriptionById } from '../db/crud/contexts.js';
import { listMentalModelsForDiff, DEFAULT_MAX_TOKENS, DEFAULT_REFRESH_MODE, DEFAULT_TAGS_MATCH_MODE, normaliseMaxTokens } from '../db/crud/mental-models.js';
import { listDirectivesForDiff } from '../db/crud/directives.js';

const logger = createLogger('hindsight-route');
const router = Router();

function deepEqual(a, b) {
  if (a === b) return true;
  if (a == null || b == null) return false;
  const aKeys = Object.keys(a);
  const bKeys = Object.keys(b);
  if (aKeys.length !== bKeys.length) return false;
  for (const key of aKeys) {
    if (!bKeys.includes(key)) return false;
    if (a[key] !== b[key]) return false;
  }
  return true;
}

function isAbsent(value) {
  if (value == null) return true;
  if (value === '') return true;
  if (Array.isArray(value) && value.length === 0) return true;
  if (typeof value === 'object' && Object.keys(value).length === 0) return true;
  return false;
}

/* ── Mental model comparison helpers ── */

function normalizeCsv(value) {
  if (value == null || value === '') return [];
  return String(value).split(',').map((s) => s.trim()).filter(Boolean);
}

function arraySetEqual(a, b) {
  if (a.length !== b.length) return false;
  const setB = new Set(b);
  return a.every((x) => setB.has(x));
}

function buildMentalModelDivergence(arch, hind) {
  const nameDiffers = arch.name !== (hind.name ?? null);
  const sourceQueryDiffers = arch.source_query !== (hind.source_query ?? null);
  const maxTokensDiffers = Number(arch.max_tokens) !== Number(hind.max_tokens);
  const refreshModeDiffers = arch.refresh_mode !== hind.refresh_mode;
  const refreshAfterConsolidationDiffers = !!arch.refresh_after_consolidation !== !!hind.refresh_after_consolidation;
  const excludeAllDiffers = !!arch.exclude_all_mental_models !== !!hind.exclude_all_mental_models;
  const excludeListDiffers = !arraySetEqual(
    normalizeCsv(arch.exclude_mental_model_list),
    hind.exclude_mental_model_ids || []
  );
  const tagsMatchModeDiffers = arch.tags_match_mode !== hind.tags_match_mode;
  const tagsDiffers = !arraySetEqual(
    (arch.tags || []).slice().sort(),
    (hind.tags || []).slice().sort()
  );

  return {
    name_differs: nameDiffers,
    source_query_differs: sourceQueryDiffers,
    tags_differs: tagsDiffers,
    max_tokens_differs: maxTokensDiffers,
    refresh_mode_differs: refreshModeDiffers,
    refresh_after_consolidation_differs: refreshAfterConsolidationDiffers,
    exclude_all_mental_models_differs: excludeAllDiffers,
    exclude_mental_model_list_differs: excludeListDiffers,
    tags_match_mode_differs: tagsMatchModeDiffers,
  };
}

/**
 * Derived mental models inherit template fields, but the effective architxt
 * values already substitute entity placeholders and can diverge from the bank
 * when the template changes. Use the same full comparison as plain models so
 * every badge reflects real sync state. Pull still skips derived rows; Push
 * handles them.
 */
function buildDerivedMentalModelDivergence(arch, hind) {
  return buildMentalModelDivergence(arch, hind);
}

function substituteDerived(template, entity) {
  if (!template) return template;
  return template
    .replaceAll('{entity-name}', entity.name ?? '')
    .replaceAll('{entity-id}', entity.entity_id ?? '');
}

function deriveMentalModelsForDiff(template) {
  const entities = template.mm_entities || [];
  if (!entities.length) return [];

  return entities.map((entity) => {
    const overrides = entity.overrides || {};

    /**
     * Mental model entity overrides are stored as TEXT in SQLite with values
     * 'true' / 'false' / NULL, but defensive parsing also accepts 1/0 and
     * real booleans in case the UI or future migration writes other forms.
     */
    const parseOverrideBool = (v) => {
      if (v === null || v === undefined) return null;
      if (typeof v === 'boolean') return v;
      if (typeof v === 'number') return v === 1;
      if (typeof v === 'string') {
        const trimmed = v.trim().toLowerCase();
        if (trimmed === 'true' || trimmed === '1') return true;
        if (trimmed === 'false' || trimmed === '0') return false;
      }
      logger.warn('Unrecognized mental model entity override boolean value; treating as unset', { value: v, entity });
      return null;
    };

    const refreshAfterConsolidation = parseOverrideBool(overrides.refresh_after_consolidation) ?? template.mm_refresh_after_consolidation === 'true';
    const excludeAll = parseOverrideBool(overrides.exclude_all_mental_models) ?? template.mm_exclude_all_mental_models === 'true';

    return {
      id: `${template.mm_id}:${entity.id}`,
      ext_id: substituteDerived(template.mm_ext_id, entity),
      name: substituteDerived(template.mm_name, entity),
      source_query: substituteDerived(template.mm_source_query, entity),
      refresh_after_consolidation: refreshAfterConsolidation,
      refresh_mode: overrides.refresh_mode || template.mm_refresh_mode || DEFAULT_REFRESH_MODE,
      exclude_all_mental_models: excludeAll,
      exclude_mental_model_list: template.mm_exclude_mental_model_list,
      max_tokens: normaliseMaxTokens(overrides.max_tokens) ?? template.mm_max_tokens ?? DEFAULT_MAX_TOKENS,
      tags_match_mode: template.mm_tags_match_mode || DEFAULT_TAGS_MATCH_MODE,
      tags: template.mm_tag_names || [],
      is_derived: true,
      derived_entity: { id: entity.id, mm_id: template.mm_id, entity_id: entity.entity_id, name: entity.name },
      __rawOverrides: overrides,
    };
  });
}

/**
 * Parse an ISO-like timestamp, treating bare strings (no timezone) as Zulu.
 * This handles legacy architxt timestamps that were stored without a Z suffix.
 */
function parseTimestamp(ts) {
  if (!ts || ts === '') return new Date(0);
  const hasTz = /[Zz]|[+-]\d{2}:?\d{2}$/.test(ts);
  const normalised = hasTz ? ts : ts + 'Z';
  return new Date(normalised);
}

/**
 * @openapi
 * /hindsight/diff:
 *   get:
 *     summary: Compare architxt documents with Hindsight server bank
 *     description: |
 *       Fetches documents from both architxt DB and a remote Hindsight server/bank,
 *       then categorises them by presence and content_hash match.
 *     tags: [Hindsight]
 *     parameters:
 *       - in: query
 *         name: server_id
 *         required: true
 *         schema: { type: integer }
 *         description: Server ID from servers table
 *       - in: query
 *         name: bank_id
 *         required: true
 *         schema: { type: string }
 *         description: Hindsight bank identifier
 *     responses:
 *       200:
 *         description: Diff result with four categories
 *       400:
 *         description: Missing server_id or bank_id
 *       502:
 *         description: Hindsight server error
 */
router.get('/diff', async (req, res) => {
  const start = Date.now();

  const serverId = parseInt(req.query.server_id, 10);
  const bankId = req.query.bank_id;
  const object = req.query.object || 'documents';
  const summaryMode = req.query.summary === 'true';
  logger.warn('Hindsight diff: start', { serverId, bankId, object, summaryMode });

  if (!serverId || !bankId) {
    return res.status(400).json({
      error: 'server_id and bank_id are required',
      code: 'VALIDATION_ERROR'
    });
  }

  // ── Entities branch ──
  if (object === 'entities') {
    try {
      // 1. Fetch Hindsight bank config → entity labels (type === 'map' only)
      const configResult = await getBankConfig(serverId, bankId);
      if (!configResult.success) {
        return res.status(502).json({ error: configResult.error, code: 'REMOTE_ERROR' });
      }

      const rawLabels = configResult.config?.config?.entity_labels || [];
      const mapLabels = Array.isArray(rawLabels)
        ? rawLabels.filter((l) => l.type === 'multi-values')
        : [];

      // Build hindsight entity map: key -> { key, values, description }
      const hindMap = new Map();
      for (const label of mapLabels) {
        const values = (label.values || []).map((v) => ({
          entity_id: v.value != null ? String(v.value) : '',
          name: v.description || '',
        }));
        hindMap.set(label.key, {
          key: label.key,
          values,
          description: label.description || '',
        });
      }

      // 2. Fetch architxt entities with their type_name
      const entityResult = await getAllEntitiesWithTypes(db);
      if (!entityResult.success) {
        throw new Error(`Failed to fetch entities: ${entityResult.error}`);
      }
      const archRows = entityResult.data;

      // Build architxt entity map keyed by type_name
      const archByType = new Map();
      const archTypeDescriptions = new Map();
      for (const row of archRows) {
        const typeName = row.et_type_name;
        if (!archByType.has(typeName)) {
          archByType.set(typeName, []);
          archTypeDescriptions.set(typeName, row.et_description || '');
        }
        archByType.get(typeName).push({
          id: row.ent_id,
          entity_id: row.ent_entity_id,
          name: row.ent_name,
          description: row.ent_description || '',
          aliases: row.ent_aliases ? JSON.parse(row.ent_aliases) : [],
          type_name: typeName,
        });
      }

      // 3. Categorise by TYPE (one row per entity type)
      const same = [];
      const different = [];
      const onlyArchitxt = [];
      const onlyHindsight = [];

      const allTypeNames = new Set([...archByType.keys(), ...hindMap.keys()]);

      for (const typeName of allTypeNames) {
        const archEntities = archByType.get(typeName) || [];
        const hind = hindMap.get(typeName);

        // Build arch id -> entity map for fast lookup
        const archById = new Map();
        for (const ent of archEntities) {
          archById.set(String(ent.entity_id), ent);
        }

        const archValues = summaryMode
          ? null
          : archEntities.map((e) => ({
              entity_id: String(e.entity_id),
              name: e.name,
              description: e.description || '',
            }));

        if (!hind) {
          // Type only on architxt
          onlyArchitxt.push({
            ext_id: typeName,
            arch: {
              type_name: typeName,
              count: archEntities.length,
              values: archValues,
            },
          });
          continue;
        }

        const hindValues = summaryMode ? null : hind.values;
        const hindNameById = new Map();
        for (const v of hindValues) {
          hindNameById.set(v.entity_id, v.name);
        }

        if (archEntities.length === 0) {
          // Type only on Hindsight
          onlyHindsight.push({
            ext_id: typeName,
            hindsight: {
              key: typeName,
              count: hindValues.length,
              values: hindValues,
            },
          });
          continue;
        }

        // Compare value sets
        const archIdSet = new Set(archEntities.map((e) => String(e.entity_id)));
        const hindIdSet = new Set(hindValues.map((v) => v.entity_id));

        let nameDiffers = false;
        const nameMismatches = [];
        const missingInArch = [];
        const missingInHind = [];

        for (const hv of hindValues) {
          if (!archIdSet.has(hv.entity_id)) {
            missingInArch.push(hv.entity_id);
          } else {
            const archEnt = archById.get(hv.entity_id);
            if (archEnt.name !== hv.name) {
              nameDiffers = true;
              nameMismatches.push({
                entity_id: hv.entity_id,
                arch: archEnt.name,
                hind: hv.name,
              });
            }
          }
        }

        for (const av of archValues) {
          if (!hindIdSet.has(av.entity_id)) {
            missingInHind.push(av.entity_id);
          }
        }

        const idDiffers = missingInArch.length > 0 || missingInHind.length > 0;
        const archTypeDesc = archTypeDescriptions.get(typeName) || '';
        const descriptionDiffers = archTypeDesc !== (hind.description || '');
        const syncedFields = getSyncedFields();

        const divergence = {
          id_differs: idDiffers,
          name_differs: nameDiffers,
          description_differs: descriptionDiffers,
          synced_fields: syncedFields,
          arch_count: archEntities.length,
          hind_count: hindValues.length,
          missing_in_arch: missingInArch,
          missing_in_hind: missingInHind,
          name_mismatches: nameMismatches,
          orphan_names: [],
        };

        const row = {
          ext_id: typeName,
          arch: summaryMode
            ? { type_name: typeName, count: archEntities.length }
            : {
                type_name: typeName,
                description: archTypeDescriptions.get(typeName) || '',
                count: archEntities.length,
                values: archValues,
              },
          hindsight: summaryMode
            ? { key: typeName, count: hindValues?.length ?? 0 }
            : {
                key: typeName,
                description: hind.description || '',
                count: hindValues.length,
                values: hindValues,
              },
          divergence,
        };

        if (!idDiffers && !nameDiffers && !descriptionDiffers) {
          same.push(row);
        } else {
          different.push(row);
        }
      }

      return res.json({
        data: { same, different, only_architxt: onlyArchitxt, only_hindsight: onlyHindsight },
        counts: {
          same: same.length,
          different: different.length,
          only_architxt: onlyArchitxt.length,
          only_hindsight: onlyHindsight.length,
          total: same.length + different.length + onlyArchitxt.length + onlyHindsight.length,
        },
      });
    } catch (err) {
      logger.error('Hindsight entities diff failed', { serverId, bankId, error: err.message, stack: err.stack });
      return res.status(500).json({ error: err.message, code: 'INTERNAL_ERROR' });
    }
  }

  // ── Mental Models branch ──
  if (object === 'mental-models') {
    try {
      // 1. Fetch Hindsight mental models with detail=content
      const hindResult = await hindsightListMentalModels(serverId, bankId, { limit: 1000, detail: 'content' });
      if (!hindResult.success) {
        return res.status(502).json({ error: hindResult.error, code: 'REMOTE_ERROR' });
      }

      const hindMap = new Map();
      for (const mm of hindResult.mentalModels || []) {
        const extId = mm.id;
        if (!extId) continue;
        hindMap.set(extId, {
          ext_id: extId,
          name: mm.name || null,
          source_query: mm.source_query || null,
          refresh_mode: mm.trigger?.mode || DEFAULT_REFRESH_MODE,
          refresh_after_consolidation: !!mm.trigger?.refresh_after_consolidation,
          exclude_all_mental_models: !!mm.trigger?.exclude_mental_models,
          exclude_mental_model_ids: Array.isArray(mm.trigger?.exclude_mental_model_ids) ? mm.trigger.exclude_mental_model_ids : [],
          max_tokens: mm.max_tokens,
          tags_match_mode: mm.trigger?.tags_match || DEFAULT_TAGS_MATCH_MODE,
          tags: Array.isArray(mm.tags) ? mm.tags : [],
        });
      }

      // 2. Fetch architxt mental models (non-templates), then expand templates into derived rows
      const archResult = await listMentalModelsForDiff(db, { limit: 1000 });
      if (!archResult.success) {
        throw new Error(`Failed to fetch mental models: ${archResult.error}`);
      }
      const archRows = archResult.data || [];

      // Separate templates and plain models
      const templates = archRows.filter((r) => r.mm_is_template === 'true');
      const plainRows = archRows.filter((r) => r.mm_is_template !== 'true');

      const derivedRows = [];
      for (const template of templates) {
        derivedRows.push(...deriveMentalModelsForDiff(template));
      }

      logger.info('Mental models diff raw inputs', {
        hindsightCount: hindMap.size,
        architxtRowCount: archRows.length,
        plainCount: plainRows.length,
        templateCount: templates.length,
        derivedCount: derivedRows.length,
        hindsightKeys: [...hindMap.keys()],
        plainExtIds: plainRows.map((r) => r.mm_ext_id),
        derivedExtIds: derivedRows.map((r) => ({ extId: r.ext_id, mmId: r.derived_entity?.mm_id, entId: r.derived_entity?.id })),
      });

      const plainCandidates = plainRows.map((r) => ({
        id: r.mm_id,
        ext_id: r.mm_ext_id,
        name: r.mm_name,
        source_query: r.mm_source_query,
        refresh_after_consolidation: r.mm_refresh_after_consolidation === 'true',
        refresh_mode: r.mm_refresh_mode || DEFAULT_REFRESH_MODE,
        exclude_all_mental_models: r.mm_exclude_all_mental_models === 'true',
        exclude_mental_model_list: r.mm_exclude_mental_model_list,
        max_tokens: r.mm_max_tokens ?? DEFAULT_MAX_TOKENS,
        tags_match_mode: r.mm_tags_match_mode || DEFAULT_TAGS_MATCH_MODE,
        tags: r.mm_tag_names || [],
        is_derived: false,
      }));

      // 3. Categorise. Keep plain and derived candidates in separate buckets so a
      // plain model and a derived instance with the same ext_id do not shadow
      // each other in a single Map.
      const same = [];
      const different = [];
      const onlyArchitxt = [];
      const onlyHindsight = [];

      const plainByExtId = new Map();
      const derivedByExtId = new Map();
      for (const arch of plainCandidates) {
        if (plainByExtId.has(arch.ext_id)) {
          logger.warn('Duplicate plain mental model ext_id', { extId: arch.ext_id });
        }
        plainByExtId.set(arch.ext_id, arch);
      }
      for (const arch of derivedRows) {
        if (derivedByExtId.has(arch.ext_id)) {
          logger.warn('Duplicate derived mental model ext_id', { extId: arch.ext_id, derived: arch.derived_entity });
        }
        derivedByExtId.set(arch.ext_id, arch);
      }

      const allArchExtIds = new Set([...plainByExtId.keys(), ...derivedByExtId.keys()]);

      for (const extId of allArchExtIds) {
        const hind = hindMap.get(extId);

        if (!hind) {
          onlyArchitxt.push({
            ext_id: extId,
            arch: summaryMode ? { ext_id: extId, is_derived: plainByExtId.get(extId)?.is_derived ?? false }
              : (plainByExtId.get(extId) || derivedByExtId.get(extId)),
          });
          continue;
        }

        const plainArch = plainByExtId.get(extId);
        const derivedArch = derivedByExtId.get(extId);

        if (plainArch) {
          const divergence = buildMentalModelDivergence(plainArch, hind);
          const anyDiffers = Object.values(divergence).some(Boolean);
          const row = {
            ext_id: extId,
            arch: summaryMode ? { ext_id: extId, is_derived: false } : plainArch,
            hindsight: summaryMode ? { ext_id: extId } : hind,
            divergence,
          };
          if (anyDiffers) different.push(row);
          else same.push(row);
        }

        if (derivedArch) {
          const divergence = buildDerivedMentalModelDivergence(derivedArch, hind);
          const anyDiffers = Object.values(divergence).some(Boolean);
          const row = {
            ext_id: extId,
            arch: summaryMode ? { ext_id: extId, is_derived: true } : derivedArch,
            hindsight: summaryMode ? { ext_id: extId } : hind,
            divergence,
          };
          logger.info('Derived mental model comparison', { extId, hasHind: !!hind, divergence, archRefreshAfter: derivedArch.refresh_after_consolidation, hindRefreshAfter: hind?.refresh_after_consolidation, rawOverrides: derivedArch.__rawOverrides });
          if (anyDiffers) {
            different.push(row);
            logger.info('Derived mental model differs', { extId, divergence, arch: derivedArch, hind });
          } else {
            same.push(row);
          }
        }

        hindMap.delete(extId);
      }

      for (const [extId, hind] of hindMap) {
        onlyHindsight.push({
          ext_id: extId,
          hindsight: summaryMode ? { ext_id: extId } : hind,
        });
      }

      return res.json({
        data: { same, different, only_architxt: onlyArchitxt, only_hindsight: onlyHindsight },
        counts: {
          same: same.length,
          different: different.length,
          only_architxt: onlyArchitxt.length,
          only_hindsight: onlyHindsight.length,
          total: same.length + different.length + onlyArchitxt.length + onlyHindsight.length,
        },
      });
    } catch (err) {
      logger.error('Hindsight mental models diff failed', { serverId, bankId, error: err.message, stack: err.stack });
      return res.status(500).json({ error: err.message, code: 'INTERNAL_ERROR' });
    }
  }

  // ── Directives branch ──
  if (object === 'directives') {
    try {
      const hindResult = await hindsightListDirectives(serverId, bankId, { limit: 1000 });
      if (!hindResult.success) {
        return res.status(502).json({ error: hindResult.error, code: 'REMOTE_ERROR' });
      }

      const hindMap = new Map();
      for (const d of hindResult.directives || []) {
        const extId = d.id;
        if (!extId) continue;
        hindMap.set(extId, {
          ext_id: extId,
          name: d.name || null,
          statement: d.content || null,
          priority: d.priority ?? 0,
          is_active: d.is_active === true,
          tags: Array.isArray(d.tags) ? d.tags : [],
        });
      }

      const archResult = await listDirectivesForDiff(db, { limit: 1000 });
      if (!archResult.success) {
        throw new Error(`Failed to fetch directives: ${archResult.error}`);
      }
      const archRows = archResult.data || [];

      const same = [];
      const different = [];
      const onlyArchitxt = [];
      const onlyHindsight = [];

      const archMap = new Map();
      for (const row of archRows) {
        const extId = row.dir_ext_id || `local:${row.dir_id}`;
        if (!extId) continue;
        const arch = {
          id: row.dir_id,
          ext_id: row.dir_ext_id || null,
          local_key: !row.dir_ext_id ? `local:${row.dir_id}` : null,
          name: row.dir_name || null,
          statement: row.dir_statement || null,
          priority: row.dir_priority ?? 0,
          is_active: row.dir_is_active === 'true',
          tags: row.dir_tag_names || [],
        };
        archMap.set(extId, arch);
      }

      for (const [extId, arch] of archMap) {
        const hind = hindMap.get(extId);
        if (!hind) {
          onlyArchitxt.push({ ext_id: extId, arch: summaryMode ? { ext_id: extId } : arch });
          continue;
        }

        const nameDiffers = (arch.name || '') !== (hind.name || '');
        const statementDiffers = (arch.statement || '') !== (hind.statement || '');
        const priorityDiffers = Number(arch.priority) !== Number(hind.priority);
        const isActiveDiffers = !!arch.is_active !== !!hind.is_active;
        const tagsDiffers = !arraySetEqual(
          (arch.tags || []).slice().sort(),
          (hind.tags || []).slice().sort()
        );

        const divergence = {
          name_differs: nameDiffers,
          statement_differs: statementDiffers,
          priority_differs: priorityDiffers,
          is_active_differs: isActiveDiffers,
          tags_differs: tagsDiffers,
        };
        const anyDiffers = Object.values(divergence).some(Boolean);
        const row = {
          ext_id: extId,
          arch: summaryMode ? { ext_id: extId } : arch,
          hindsight: summaryMode ? { ext_id: extId } : hind,
          divergence,
        };

        if (anyDiffers) different.push(row);
        else same.push(row);

        hindMap.delete(extId);
      }

      for (const [extId, hind] of hindMap) {
        onlyHindsight.push({ ext_id: extId, hindsight: summaryMode ? { ext_id: extId } : hind });
      }

      return res.json({
        data: { same, different, only_architxt: onlyArchitxt, only_hindsight: onlyHindsight },
        counts: {
          same: same.length,
          different: different.length,
          only_architxt: onlyArchitxt.length,
          only_hindsight: onlyHindsight.length,
          total: same.length + different.length + onlyArchitxt.length + onlyHindsight.length,
        },
      });
    } catch (err) {
      logger.error('Hindsight directives diff failed', { serverId, bankId, error: err.message, stack: err.stack });
      return res.status(500).json({ error: err.message, code: 'INTERNAL_ERROR' });
    }
  }

  try {
    // 1. Fetch architxt documents (need all fields used by system expanders)
    const docResult = await getDocumentsForDiff(db);
    if (!docResult.success) {
      return res.status(500).json({ error: docResult.error, code: docResult.code });
    }
    const archRows = docResult.data;

    const archMap = new Map();
    for (const row of archRows) {
      archMap.set(row.doc_ext_id, {
        id: row.doc_id,
        ext_id: row.doc_ext_id,
        content_hash: row.doc_content_hash,
        filename: row.doc_filename,
        status: row.doc_status,
        timestamp: row.doc_timestamp,
        ctxt_id: row.ctxt_id,
        full_path: row.doc_full_path,
        authors: row.doc_authors,
        content: row.doc_content,
      });
    }

    // 2. Fetch Hindsight documents
    const hindsightResult = await hindsightListDocuments(serverId, bankId, { limit: 10000 });
    if (!hindsightResult.success) {
      return res.status(502).json({
        error: hindsightResult.error,
        code: 'REMOTE_ERROR'
      });
    }

    const hindsightDocs = hindsightResult.documents || [];
    logger.warn('Hindsight diff: raw docs count', { count: hindsightDocs.length, sampleKeys: hindsightDocs.slice(0,3).map(d => Object.keys(d)) });

    const hindMap = new Map();
    for (const doc of hindsightDocs) {
      // Contract: Hindsight items use 'id' as the external document identifier
      const extId = doc.id;
      if (!extId) {
        logger.warn('Hindsight diff: item missing id, skipping', { keys: Object.keys(doc) });
        continue;
      }

      hindMap.set(extId, {
        id: doc.id,
        ext_id: extId,
        content_hash: doc.content_hash || null,
        title: doc.title || doc.name || doc.filename || null,
        tags: doc.tags || [],
        document_metadata: doc.document_metadata || null,
        retain_params: doc.retain_params || null,
        timestamp: doc.timestamp || null,
      });
    }
    logger.warn('Hindsight diff: mapped count', { mapped: hindMap.size });

    // 2b. Fetch all architxt tags for fast comparison
    const tagResult = await getAllDocumentTags(db);
    if (!tagResult.success) {
      return res.status(500).json({ error: tagResult.error, code: tagResult.code });
    }
    const tagRows = tagResult.data;
    const docTagsMap = new Map();
    for (const row of tagRows) {
      if (!docTagsMap.has(row.doc_id)) docTagsMap.set(row.doc_id, new Set());
      docTagsMap.get(row.doc_id).add(row.tag_name);
    }

    // 2c. Fetch all architxt contexts
    const ctxResult = await getAllDocumentContexts(db);
    if (!ctxResult.success) {
      return res.status(500).json({ error: ctxResult.error, code: ctxResult.code });
    }
    const ctxRows = ctxResult.data;
    const docContextMap = new Map();
    for (const row of ctxRows) {
      docContextMap.set(row.doc_id, row.ctxt_desc);
    }

    // 3. Categorise + divergence detection
    const same = [];
    const different = [];
    const onlyArchitxt = [];
    const onlyHindsight = [];

    function tagsMatch(archId, hindTags) {
      const archTags = docTagsMap.get(archId) || new Set();
      const hindTagSet = new Set(hindTags || []);
      if (archTags.size !== hindTagSet.size) return false;
      for (const tag of archTags) {
        if (!hindTagSet.has(tag)) return false;
      }
      return true;
    }

    function buildDivergence(arch, hind) {
      const archHash = arch.content_hash || null;
      const hindHash = hind.content_hash || null;

      // Use EXPANDED metadata (computed live values from document fields),
      // not raw seed placeholders, so divergence matches the compare endpoint.
      const docLike = {
        doc_id: arch.id,
        doc_full_path: arch.full_path,
        doc_filename: arch.filename,
        doc_timestamp: arch.timestamp,
        doc_authors: arch.authors,
        doc_content: arch.content,
      };
      const expandedMetaResult = getExpandedDocumentMetadata(db, arch.id, docLike);
      const archMeta = {};
      if (expandedMetaResult && expandedMetaResult.success && expandedMetaResult.data) {
        for (const row of expandedMetaResult.data) {
          if (row.meta_value !== null && row.meta_value !== undefined) {
            archMeta[row.meta_key] = row.meta_value;
          }
        }
      }
      const hindMeta = hind.document_metadata || {};
      const metaDiffers = !((isAbsent(archMeta) && isAbsent(hindMeta)) || deepEqual(archMeta, hindMeta));

      const archCtx = docContextMap.get(arch.id) || null;
      const hindCtx = hind.retain_params?.context || null;
      const ctxDiffers = !((isAbsent(archCtx) && isAbsent(hindCtx)) || archCtx === hindCtx);

      const archDate = arch.timestamp || null;
      const hindDate = hind.retain_params?.event_date || null;
      const dateDiffers = !((isAbsent(archDate) && isAbsent(hindDate)) ||
        (parseTimestamp(archDate).getTime() === parseTimestamp(hindDate).getTime()));

      return {
        content_differs: !(archHash && hindHash && archHash === hindHash),
        tags_differs: !tagsMatch(arch.id, hind.tags),
        metadata_differs: metaDiffers,
        context_differs: ctxDiffers,
        date_differs: dateDiffers,
      };
    }

    for (const [extId, arch] of archMap) {
      const hind = hindMap.get(extId);
      if (!hind) {
        onlyArchitxt.push({ ext_id: extId, arch: summaryMode ? { ext_id: extId } : arch });
      } else {
        const divergence = buildDivergence(arch, hind);
        const anyDiffers = divergence.content_differs || divergence.tags_differs || divergence.metadata_differs || divergence.context_differs || divergence.date_differs;
        if (!anyDiffers) {
          same.push({
            ext_id: extId,
            arch: summaryMode ? { ext_id: extId, content_hash: arch.content_hash } : arch,
            hindsight: summaryMode ? { ext_id: extId, content_hash: hind.content_hash } : hind,
            divergence,
          });
        } else {
          different.push({
            ext_id: extId,
            arch: summaryMode ? { ext_id: extId, content_hash: arch.content_hash } : arch,
            hindsight: summaryMode ? { ext_id: extId, content_hash: hind.content_hash } : hind,
            divergence,
          });
        }
        hindMap.delete(extId);
      }
    }

    for (const [extId, hind] of hindMap) {
      onlyHindsight.push({ ext_id: extId, hindsight: summaryMode ? { ext_id: extId } : hind });
    }

    res.json({
      data: { same, different, only_architxt: onlyArchitxt, only_hindsight: onlyHindsight },
      counts: {
        same: same.length,
        different: different.length,
        only_architxt: onlyArchitxt.length,
        only_hindsight: onlyHindsight.length,
        total: same.length + different.length + onlyArchitxt.length + onlyHindsight.length,
      }
    });

  } catch (err) {
    logger.error('Hindsight diff failed', { error: err.message, stack: err.stack });
    res.status(500).json({ error: err.message, code: 'INTERNAL_ERROR' });
  }
});

/**
 * @openapi
 * /hindsight/pull:
 *   post:
 *     summary: Pull a document from Hindsight into architxt
 *     description: |
 *       Fetches a single document from a Hindsight server/bank and syncs it
 *       into architxt. If the ext_id already exists, updates the existing row.
 *       If it does not exist, creates a new document row.
 *     tags: [Hindsight]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [server_id, bank_id, document_id]
 *             properties:
 *               server_id: { type: integer }
 *               bank_id: { type: string }
 *               document_id: { type: string }
 *     responses:
 *       200:
 *         description: Document pulled successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success: { type: boolean }
 *                 created: { type: boolean }
 *                 document: { type: object }
 *       400:
 *         description: Validation error
 *       502:
 *         description: Hindsight server error
 */
router.post('/pull', async (req, res) => {
  const serverId = parseInt(req.body.server_id, 10);
  const bankId = req.body.bank_id;
  const documentId = req.body.document_id;

  if (!serverId || !bankId || !documentId) {
    return res.status(400).json({
      error: 'server_id, bank_id, and document_id are required',
      code: 'VALIDATION_ERROR'
    });
  }

  try {
    const result = await pullDocument(serverId, bankId, documentId);
    if (!result.success) {
      return res.status(502).json({ error: result.error, code: 'PULL_FAILED' });
    }
    res.json({
      success: true,
      created: result.created,
      document: result.document,
    });
  } catch (err) {
    logger.error('Pull failed', { serverId, bankId, documentId, error: err.message, stack: err.stack });
    res.status(500).json({ error: err.message, code: 'INTERNAL_ERROR' });
  }
});

/**
 * @openapi
 * /hindsight/push:
 *   post:
 *     summary: Push an architxt document to Hindsight
 *     description: |
 *       Sends a document from architxt to Hindsight via retainMemories
 *       with update_mode: 'replace'. Returns an operation_id for polling.
 *     tags: [Hindsight]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [server_id, bank_id, doc_id]
 *             properties:
 *               server_id: { type: integer }
 *               bank_id: { type: string }
 *               doc_id: { type: integer }
 *     responses:
 *       200:
 *         description: Push initiated
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success: { type: boolean }
 *                 operation_id: { type: string }
 *       400:
 *         description: Validation error
 *       502:
 *         description: Hindsight server error
 */
router.post('/push', async (req, res) => {
  const serverId = parseInt(req.body.server_id, 10);
  const bankId = req.body.bank_id;
  const docId = parseInt(req.body.doc_id, 10);

  if (!serverId || !bankId || !docId) {
    return res.status(400).json({
      error: 'server_id, bank_id, and doc_id are required',
      code: 'VALIDATION_ERROR'
    });
  }

  try {
    const result = await pushDocument(serverId, bankId, docId);
    if (!result.success) {
      return res.status(502).json({ error: result.error, code: 'PUSH_FAILED' });
    }
    res.json({
      success: true,
      operation_id: result.operationId,
      pop_id: result.popId,
    });
  } catch (err) {
    logger.error('Push failed', { serverId, bankId, docId, error: err.message, stack: err.stack });
    res.status(500).json({ error: err.message, code: 'INTERNAL_ERROR' });
  }
});

/**
 * @openapi
 * /hindsight/push-mental-model:
 *   post:
 *     summary: Push an architxt mental model to Hindsight
 *     description: |
 *       Patches a single mental model into the selected Hindsight bank using
 *       the architxt mental model values. Works for plain models and derived
 *       template instances.
 *     tags: [Hindsight]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [server_id, bank_id, model]
 *             properties:
 *               server_id: { type: integer }
 *               bank_id: { type: string }
 *               model: { type: object }
 *     responses:
 *       200:
 *         description: Push completed
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success: { type: boolean }
 *       400:
 *         description: Validation error
 *       502:
 *         description: Hindsight server error
 */
router.post('/push-mental-model', async (req, res) => {
  const serverId = parseInt(req.body.server_id, 10);
  const bankId = req.body.bank_id;
  const model = req.body.model;
  const create = req.body.create === true;

  if (!serverId || !bankId || !model || !model.ext_id) {
    return res.status(400).json({
      error: 'server_id, bank_id, and model.ext_id are required',
      code: 'VALIDATION_ERROR'
    });
  }

  try {
    const result = create
      ? await createMentalModel(serverId, bankId, model)
      : await pushMentalModel(serverId, bankId, model);
    if (!result.success) {
      return res.status(502).json({ error: result.error, code: 'PUSH_FAILED' });
    }
    res.json({ success: true, created: create });
  } catch (err) {
    logger.error('Push mental model failed', { serverId, bankId, extId: model?.ext_id, error: err.message, stack: err.stack });
    res.status(500).json({ error: err.message, code: 'INTERNAL_ERROR' });
  }
});

/**
 * @openapi
 * /hindsight/push/directive:
 *   post:
 *     summary: Push a directive to Hindsight
 *     description: |
 *       Pushes an architxt directive to Hindsight. If the directive already
 *       has an ext_id it is PATCHed; otherwise it is POSTed and the returned
 *       Hindsight id is stored locally.
 *     tags: [Hindsight]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [server_id, bank_id, dir_id]
 *             properties:
 *               server_id: { type: integer }
 *               bank_id: { type: string }
 *               dir_id: { type: integer }
 *     responses:
 *       200:
 *         description: Push completed
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success: { type: boolean }
 *                 ext_id: { type: string }
 *       400:
 *         description: Validation error
 *       502:
 *         description: Hindsight server error
 */
router.post('/push/directive', async (req, res) => {
  const serverId = parseInt(req.body.server_id, 10);
  const bankId = req.body.bank_id;
  const dirId = parseInt(req.body.dir_id, 10);

  if (!serverId || !bankId || !dirId) {
    return res.status(400).json({
      error: 'server_id, bank_id, and dir_id are required',
      code: 'VALIDATION_ERROR'
    });
  }

  try {
    const result = await pushHindsightDirective(serverId, bankId, dirId);
    if (!result.success) {
      return res.status(502).json({ error: result.error, code: 'PUSH_FAILED' });
    }
    res.json({ success: true, ext_id: result.ext_id });
  } catch (err) {
    logger.error('Push directive failed', { serverId, bankId, dirId, error: err.message, stack: err.stack });
    res.status(500).json({ error: err.message, code: 'INTERNAL_ERROR' });
  }
});

/**
 * @openapi
 * /hindsight/pull/directive:
 *   post:
 *     summary: Pull a directive from Hindsight into architxt
 *     description: |
 *       Pulls a single directive from the selected Hindsight bank into
 *       architxt. If a directive with the same ext_id exists locally it is
 *       updated; otherwise a new directive is created.
 *     tags: [Hindsight]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [server_id, bank_id, directive_id]
 *             properties:
 *               server_id: { type: integer }
 *               bank_id: { type: string }
 *               directive_id: { type: string }
 *     responses:
 *       200:
 *         description: Pull completed
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success: { type: boolean }
 *                 created: { type: boolean }
 *       400:
 *         description: Validation error
 *       502:
 *         description: Hindsight server error
 */
router.post('/pull/directive', async (req, res) => {
  const serverId = parseInt(req.body.server_id, 10);
  const bankId = req.body.bank_id;
  const directiveId = req.body.directive_id;

  if (!serverId || !bankId || !directiveId) {
    return res.status(400).json({
      error: 'server_id, bank_id, and directive_id are required',
      code: 'VALIDATION_ERROR'
    });
  }

  try {
    const result = await pullHindsightDirective(serverId, bankId, directiveId);
    if (!result.success) {
      return res.status(502).json({ error: result.error, code: 'PULL_FAILED' });
    }
    res.json({ success: true, created: result.created });
  } catch (err) {
    logger.error('Pull directive failed', { serverId, bankId, directiveId, error: err.message, stack: err.stack });
    res.status(500).json({ error: err.message, code: 'INTERNAL_ERROR' });
  }
});

/**
 * @openapi
 * /hindsight/pull-mental-models:
 *   post:
 *     summary: Pull mental models from Hindsight into architxt
 *     description: |
 *       Pulls one or more mental models from the selected Hindsight bank
 *       into architxt. Missing local models are created; existing ones are
 *       updated. Derived rows only update their per-entity override fields.
 *       Tags are synced by name.
 *     tags: [Hindsight]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [server_id, bank_id]
 *             properties:
 *               server_id: { type: integer }
 *               bank_id: { type: string }
 *               ext_ids: { type: array, items: { type: string } }
 *               arch_info: { type: array, items: { type: object } }
 *     responses:
 *       200:
 *         description: Pull completed
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success: { type: boolean }
 *                 created: { type: integer }
 *                 updated: { type: integer }
 *                 errors: { type: array, items: { type: string } }
 *       400:
 *         description: Validation error
 *       502:
 *         description: Hindsight server error
 */
router.post('/pull-mental-models', async (req, res) => {
  const serverId = parseInt(req.body.server_id, 10);
  const bankId = req.body.bank_id;
  const targets = req.body.targets;

  if (!serverId || !bankId) {
    return res.status(400).json({
      error: 'server_id and bank_id are required',
      code: 'VALIDATION_ERROR'
    });
  }

  try {
    if (targets !== undefined && !Array.isArray(targets)) {
      return res.status(400).json({ error: 'targets must be an array', code: 'VALIDATION_ERROR' });
    }

    const result = await pullMentalModels(serverId, bankId, targets);
    if (!result.success) {
      return res.status(502).json({ error: result.errors?.join('; '), code: 'PULL_FAILED' });
    }
    res.json({
      success: true,
      created: result.created,
      updated: result.updated,
      inSync: result.inSync,
      errors: result.errors || [],
    });
  } catch (err) {
    logger.error('Pull mental models failed', { serverId, bankId, targets, error: err.message, stack: err.stack });
    res.status(500).json({ error: err.message, code: 'INTERNAL_ERROR' });
  }
});

/**
 * @openapi
 * /hindsight/compare:
 *   get:
 *     summary: Deep-compare a single document between architxt and Hindsight
 *     description: |
 *       Fetches the full document from Hindsight and the full architxt document
 *       with tags, metadata, and context, then returns a side-by-side field
 *       comparison with same/different flags for each aspect.
 *     tags: [Hindsight]
 *     parameters:
 *       - in: query
 *         name: server_id
 *         required: true
 *         schema: { type: integer }
 *       - in: query
 *         name: bank_id
 *         required: true
 *         schema: { type: string }
 *       - in: query
 *         name: document_id
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: Detailed field comparison
 */
router.get('/compare', async (req, res) => {
  const serverId = parseInt(req.query.server_id, 10);
  const bankId = req.query.bank_id;
  const documentId = req.query.document_id;

  if (!serverId || !bankId || !documentId) {
    return res.status(400).json({
      error: 'server_id, bank_id, and document_id are required',
      code: 'VALIDATION_ERROR'
    });
  }

  try {
    // 1. Fetch full Hindsight document
    const hindResult = await hindsightGetDocument(serverId, bankId, documentId);
    if (!hindResult.success) {
      return res.status(502).json({ error: hindResult.error, code: 'REMOTE_ERROR' });
    }
    const h = hindResult.document;

    // 2. Fetch architxt document by ext_id
    const archResult = await getDocumentByExtId(db, documentId);
    const archRow = archResult.success ? archResult.data : null;

    if (!archRow) {
      return res.status(404).json({
        error: 'Document not found in architxt',
        code: 'NOT_FOUND'
      });
    }

    // 3. Fetch architxt tags
    const tagResult = await getDocumentTagsByDocId(db, archRow.doc_id);
    const tagRows = tagResult.success ? tagResult.data : [];
    const archTags = tagRows.map(r => r.tag_name);

    // 4. Fetch architxt metadata (expanded — direct + system presets)
    const metaResult = getExpandedDocumentMetadata(db, archRow.doc_id);
    const archMetadata = {};
    if (metaResult && metaResult.success && metaResult.data) {
      for (const row of metaResult.data) {
        // Skip null values (no data available for this preset)
        if (row.meta_value !== null && row.meta_value !== undefined) {
          archMetadata[row.meta_key] = row.meta_value;
        }
      }
    }

    // 5. Fetch architxt context
    let archContext = null;
    if (archRow.ctxt_id) {
      const ctxResult = await getContextDescriptionById(db, archRow.ctxt_id);
      archContext = ctxResult.success ? ctxResult.data : null;
    }

    // 6. Build field comparison
    const hindTags = h.tags || [];
    const hindMetadata = h.document_metadata || {};
    const hindContext = h.retain_params?.context || null;
    const hindDate = h.retain_params?.event_date || h.timestamp || null;

    const fields = [
      {
        name: 'content_hash',
        architxt: archRow.doc_content_hash || null,
        hindsight: h.content_hash || null,
        same: (archRow.doc_content_hash && h.content_hash && archRow.doc_content_hash === h.content_hash) || false,
      },
      {
        name: 'tags',
        architxt: archTags,
        hindsight: hindTags,
        same: archTags.length === hindTags.length && archTags.every(t => hindTags.includes(t)),
      },
      {
        name: 'metadata',
        architxt: archMetadata,
        hindsight: hindMetadata,
        same: deepEqual(archMetadata, hindMetadata),
      },
      {
        name: 'context',
        architxt: archContext,
        hindsight: hindContext,
        same: (isAbsent(archContext) && isAbsent(hindContext)) || archContext === hindContext,
      },
      {
        name: 'event_date',
        architxt: archRow.doc_timestamp || null,
        hindsight: hindDate,
        same: (isAbsent(archRow.doc_timestamp) && isAbsent(hindDate)) || (archRow.doc_timestamp === hindDate),
      },
    ];

    res.json({
      ext_id: documentId,
      architxt_id: archRow.doc_id,
      fields,
    });
  } catch (err) {
    logger.error('Compare failed', { serverId, bankId, documentId, error: err.message, stack: err.stack });
    res.status(500).json({ error: err.message, code: 'INTERNAL_ERROR' });
  }
});

/**
 * @openapi
 * /hindsight/operations:
 *   get:
 *     summary: List pending operations for a server+bank
 *     description: Returns all pending_operations rows for the given server_id and bank_id.
 *     tags: [Hindsight]
 *     parameters:
 *       - in: query
 *         name: server_id
 *         required: true
 *         schema: { type: integer }
 *       - in: query
 *         name: bank_id
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: List of operations
 *       400:
 *         description: Missing parameters
 */
router.get('/operations', async (req, res) => {
  const serverId = parseInt(req.query.server_id, 10);
  const bankId = req.query.bank_id;

  if (!serverId || !bankId) {
    return res.status(400).json({
      error: 'server_id and bank_id are required',
      code: 'VALIDATION_ERROR'
    });
  }

  try {
    const result = listPendingByServerBank(db, serverId, bankId);
    if (!result.success) {
      return res.status(500).json({ error: result.error, code: result.code });
    }
    res.json({
      success: true,
      operations: result.data || [],
      server_id: serverId,
      bank_id: bankId,
    });
  } catch (err) {
    logger.error('List operations failed', { serverId, bankId, error: err.message });
    res.status(500).json({ error: err.message, code: 'INTERNAL_ERROR' });
  }
});

/**
 * @openapi
 * /hindsight/operations/all:
 *   get:
 *     summary: List all pending operations across all servers and banks
 *     description: Returns all pending_operations rows (excluding acknowledged) globally. Used by the top bar status indicator.
 *     tags: [Hindsight]
 *     responses:
 *       200:
 *         description: List of all operations
 *       500:
 *         description: Internal error
 */
router.get('/operations/all', async (req, res) => {
  try {
    const result = listAllPending(db);
    if (!result.success) {
      return res.status(500).json({ error: result.error, code: result.code });
    }
    res.json({
      success: true,
      operations: result.data || [],
    });
  } catch (err) {
    logger.error('List all operations failed', { error: err.message });
    res.status(500).json({ error: err.message, code: 'INTERNAL_ERROR' });
  }
});

/**
 * @openapi
 * /hindsight/operations/{id}:
 *   delete:
 *     summary: Dismiss (acknowledge) a pending operation
 *     description: Sets status to 'acknowledged'. Removes overlay from frontend grid.
 *     tags: [Hindsight]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: integer }
 *         description: Local pop_id (NOT Hindsight operation_id)
 *     responses:
 *       200:
 *         description: Dismissed
 *       404:
 *         description: Not found
 */
router.delete('/operations/:id', async (req, res) => {
  const popId = parseInt(req.params.id, 10);
  if (!popId) {
    return res.status(400).json({ error: 'id is required', code: 'VALIDATION_ERROR' });
  }

  try {
    const result = dismissPendingOperation(db, popId);
    if (!result.success) {
      return res.status(500).json({ error: result.error, code: result.code });
    }
    if (!result.data) {
      return res.status(404).json({ error: 'Operation not found', code: 'NOT_FOUND' });
    }
    res.json({ success: true, dismissed: popId });
  } catch (err) {
    logger.error('Dismiss operation failed', { popId, error: err.message });
    res.status(500).json({ error: err.message, code: 'INTERNAL_ERROR' });
  }
});

/**
 * @openapi
 * /hindsight/entities/push:
 *   post:
 *     summary: Push architxt entities to Hindsight as map labels
 *     description: |
 *       Builds map-type entity labels from architxt DB, merges with existing
 *       non-map labels on Hindsight, then PATCHES bank config.
 *     tags: [Hindsight]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [server_id, bank_id]
 *             properties:
 *               server_id: { type: integer }
 *               bank_id: { type: string }
 *               type_names: { type: array, items: { type: string }, description: 'Optional: push only these type names' }
 *     responses:
 *       200:
 *         description: Push complete
 *       400:
 *         description: Validation error
 *       502:
 *         description: Hindsight server error
 */
router.post('/entities/push', async (req, res) => {
  const serverId = parseInt(req.body.server_id, 10);
  const bankId = req.body.bank_id;
  const typeNames = req.body.type_names;

  if (!serverId || !bankId) {
    return res.status(400).json({ error: 'server_id and bank_id are required', code: 'VALIDATION_ERROR' });
  }

  try {
    const result = Array.isArray(typeNames) && typeNames.length > 0
      ? await pushEntityTypes(serverId, bankId, typeNames)
      : await pushEntities(serverId, bankId);
    if (!result.success) {
      return res.status(502).json({ error: result.error, code: 'PUSH_FAILED' });
    }
    res.json({ success: true, mapLabelsPushed: result.mapLabelsPushed });
  } catch (err) {
    logger.error('Entity push failed', { serverId, bankId, error: err.message });
    res.status(500).json({ error: err.message, code: 'INTERNAL_ERROR' });
  }
});

/**
 * @openapi
 * /hindsight/entities/pull:
 *   post:
 *     summary: Pull map-type entity labels from Hindsight into architxt
 *     description: |
 *       Fetches Hindsight bank config, creates missing entity types and
 *       entities in architxt, updates existing ones by name.
 *     tags: [Hindsight]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [server_id, bank_id]
 *             properties:
 *               server_id: { type: integer }
 *               bank_id: { type: string }
 *               type_names: { type: array, items: { type: string }, description: 'Optional: pull only these type names' }
 *     responses:
 *       200:
 *         description: Pull complete
 *       400:
 *         description: Validation error
 *       502:
 *         description: Hindsight server error
 */
router.post('/entities/pull', async (req, res) => {
  const serverId = parseInt(req.body.server_id, 10);
  const bankId = req.body.bank_id;
  const typeNames = req.body.type_names;

  if (!serverId || !bankId) {
    return res.status(400).json({ error: 'server_id and bank_id are required', code: 'VALIDATION_ERROR' });
  }

  try {
    const result = Array.isArray(typeNames) && typeNames.length > 0
      ? await pullEntityTypes(serverId, bankId, typeNames)
      : await pullEntities(serverId, bankId);
    if (!result.success) {
      return res.status(502).json({ error: result.error, code: 'PULL_FAILED' });
    }
    res.json({ success: true, createdTypes: result.createdTypes, createdEntities: result.createdEntities, updatedEntities: result.updatedEntities, deletedEntities: result.deletedEntities || 0 });
  } catch (err) {
    logger.error('Entity pull failed', { serverId, bankId, error: err.message });
    res.status(500).json({ error: err.message, code: 'INTERNAL_ERROR' });
  }
});

export default router;
