import { Router } from 'express';
import { listDocuments as hindsightListDocuments } from '../services/hindsight/documents.js';
import { getDocument as hindsightGetDocument } from '../services/hindsight/documents.js';
import { pullDocument } from '../services/hindsight/pull.js';
import { pushDocument } from '../services/hindsight/push.js';
import { pushEntities, pushEntityTypes, pullEntities, pullEntityTypes } from '../services/hindsight/entities.js';
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
  logger.warn('Hindsight diff: start', { serverId, bankId, object });

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

        const archValues = archEntities.map((e) => ({
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

        const hindValues = hind.values;
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
          arch: {
            type_name: typeName,
            description: archTypeDescriptions.get(typeName) || '',
            count: archEntities.length,
            values: archValues,
          },
          hindsight: {
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
        onlyArchitxt.push({ ext_id: extId, arch });
      } else {
        const divergence = buildDivergence(arch, hind);
        const anyDiffers = divergence.content_differs || divergence.tags_differs || divergence.metadata_differs || divergence.context_differs || divergence.date_differs;
        if (!anyDiffers) {
          same.push({ ext_id: extId, arch, hindsight: hind, divergence });
        } else {
          different.push({ ext_id: extId, arch, hindsight: hind, divergence });
        }
        hindMap.delete(extId);
      }
    }

    for (const [extId, hind] of hindMap) {
      onlyHindsight.push({ ext_id: extId, hindsight: hind });
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
