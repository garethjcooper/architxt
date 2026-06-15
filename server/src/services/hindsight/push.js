/**
 * Hindsight Push Service
 *
 * Pushes an architxt document to Hindsight via retainMemories.
 * Uses retainMemories with update_mode: 'replace' for overwrite.
 */

import { createLogger } from '../../utils/logger.js';
import { retainMemories, resolveChildOperationId } from './memories.js';
import { db } from '../../db/connection.js';
import { getDocument as getArchitxtDocument } from '../../db/crud/documents.js';
import { getExpandedDocumentMetadata } from '../../db/crud/document-metadata.js';
import { createPendingOperation } from '../../db/crud/pending-operations.js';
import { stmt } from '../../cache.js';
import { readFile } from 'node:fs/promises';

const logger = createLogger('hindsight-push');

/**
 * Fetch a document with full tag names and metadata key-values for push.
 * @param {number} docId
 * @returns {Object|null}
 */
function getDocumentWithRelations(docId) {
  const result = getArchitxtDocument(db, docId);
  if (!result || !result.success || !result.data) return null;
  const doc = result.data;

  // Fetch tag names from the junction table
  const tagRows = stmt(db, `
    SELECT t.tag_name FROM tags t
    JOIN document_tags dt ON t.tag_id = dt.tag_id
    WHERE dt.doc_id = ?
  `).all(docId);
  const tags = tagRows.map((r) => r.tag_name);

  // Fetch metadata — use EXPANDED view (direct + system preset computations)
  const metaResult = getExpandedDocumentMetadata(db, docId);
  let metadata = {};
  if (metaResult && metaResult.success && metaResult.data) {
    for (const row of metaResult.data) {
      // Skip presets that expand to null (no value available)
      if (row.meta_value !== null && row.meta_value !== undefined) {
        metadata[row.meta_key] = row.meta_value;
      }
    }
  }

  // Fetch context description
  let context = null;
  if (doc.ctxt_id) {
    const ctxRow = stmt(db, 'SELECT ctxt_desc FROM contexts WHERE ctxt_id = ?').get(doc.ctxt_id);
    context = ctxRow ? ctxRow.ctxt_desc : null;
  }

  return { ...doc, tags, metadata, context };
}

/**
 * Push a single architxt document to Hindsight.
 *
 * @param {number} serverId - Hindsight server ID
 * @param {string} bankId - Hindsight bank ID
 * @param {number} docId - architxt document ID
 * @returns {Promise<{success: boolean, operationId?: string, error?: string}>}
 */
export async function pushDocument(serverId, bankId, docId) {
  logger.info('Pushing document to Hindsight', { serverId, bankId, docId });

  const doc = getDocumentWithRelations(docId);
  if (!doc) {
    return { success: false, error: `Document ${docId} not found` };
  }

  // Read content from DB or from disk source_path
  let content = doc.doc_content || '';
  if (!content && doc.doc_source_path) {
    try {
      content = await readFile(doc.doc_source_path, 'utf-8');
    } catch (readErr) {
      logger.error('Failed to read source file for push', { docId, path: doc.doc_source_path, error: readErr.message });
      return { success: false, error: `Cannot read source file: ${readErr.message}` };
    }
  }

  // Build payload per Hindsight retainMemories contract
  const payload = {
    items: [{
      content: content,
      document_id: doc.doc_ext_id || String(docId),
      timestamp: doc.doc_timestamp || null,
      context: doc.context,
      metadata: Object.keys(doc.metadata).length > 0 ? doc.metadata : undefined,
      tags: doc.tags.length > 0 ? doc.tags : undefined,
      update_mode: 'replace',
    }],
  };

  // Don't send explicit null for optional fields — Hindsight rejects them
  const item = payload.items[0];
  if (!item.timestamp) delete item.timestamp;
  if (!item.context) delete item.context;
  if (!item.metadata) delete item.metadata;
  if (!item.tags) delete item.tags;

  logger.debug('Retain payload ready', {
    documentId: item.document_id,
    hasContent: !!item.content,
    contentLength: item.content?.length,
    hasContext: !!item.context,
    hasMetadata: !!item.metadata,
    hasTags: !!item.tags
  });

  // Call retainMemories with async=true
  const result = await retainMemories(serverId, bankId, payload, /* async */ true);

  if (!result.success) {
    logger.error('Push retainMemories failed', { serverId, bankId, docId, error: result.error });
    return { success: false, error: result.error };
  }

  // retainMemories returns a batch_retain PARENT id.
  // We need the child operation_id for tracking — call getOperation to resolve it.
  const resolvedResult = await resolveChildOperationId(serverId, bankId, result.operationId);
  if (!resolvedResult.success) {
    logger.error('Push failed to resolve child operation_id', { serverId, bankId, docId, parentOperationId: result.operationId, error: resolvedResult.error });
    // We still have a parent ID — store it. The daemon may not be able to track it,
    // but the user gets immediate feedback that something is pending.
  }
  const childOperationId = resolvedResult.success ? resolvedResult.childOperationId : result.operationId;

  logger.info('Push initiated successfully', {
    serverId,
    bankId,
    docId,
    parentOperationId: result.operationId,
    childOperationId,
  });

  // Persist operation tracking in local DB
  const pendingResult = createPendingOperation(db, {
    pop_operation_id: childOperationId,
    pop_server_id: serverId,
    pop_bank_id: bankId,
    pop_doc_id: docId,
    pop_ext_id: doc.doc_ext_id || String(docId),
    pop_action: 'push',
    pop_status: 'pending',
  });
  let popId = null;
  if (pendingResult.success) {
    popId = pendingResult.data;
  } else {
    logger.warn('Failed to persist pending operation row', {
      serverId, bankId, docId, operationId: result.operationId,
      error: pendingResult.error, code: pendingResult.code
    });
  }

  return {
    success: true,
    operationId: childOperationId,
    popId,
  };
}
