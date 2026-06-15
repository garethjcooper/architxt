/**
 * Hindsight Pull Service
 *
 * Pulls a document from a Hindsight server into architxt.
 * Handles both sync (existing architxt doc) and new (no existing doc).
 */

import { createLogger } from '../../utils/logger.js';
import { getDocument as getHindsightDocument } from './documents.js';
import { db } from '../../db/connection.js';
import {
  getDocument as getArchitxtDocument,
  createDocument,
  updateDocument,
} from '../../db/crud/documents.js';
import { addDocumentTag, removeAllDocumentTags } from '../../db/crud/document-tags.js';
import { createTag } from '../../db/crud/tags.js';
import { addDocumentMetadata, removeAllDocumentMetadata } from '../../db/crud/document-metadata.js';
import { createMetadata } from '../../db/crud/metadata.js';
import { createContext } from '../../db/crud/contexts.js';
import { writeToStorage } from '../../utils/file-helpers.js';
import { config } from '../../config.js';
import path from 'path';

const logger = createLogger('hindsight-pull');

/**
 * Resolve or create a context by description string.
 * Returns the context_id (number).
 */
function resolveContextId(contextDesc) {
  if (!contextDesc) return null;

  // Direct SQL lookup — avoids LIMIT truncation from DB layer
  const existing = db
    .prepare('SELECT ctxt_id FROM contexts WHERE ctxt_desc = ?')
    .get(contextDesc);
  if (existing) return existing.ctxt_id;

  // Generate a deterministic hash for generated_by
  const ctxResult = createContext(db, {
    ctxt_desc: contextDesc,
    ctxt_generated_by: 'import'
  });
  if (!ctxResult.success || !ctxResult.data) {
    logger.error('resolveContextId: creation failed', { contextDesc, error: ctxResult.error, code: ctxResult.code });
    return null;
  }
  return ctxResult.data;
}

/**
 * Sync tags for a document.
 * Deletes existing tag relationships, then creates/applies new tags.
 * Uses direct SQL for lookup to avoid the LIMIT 100 truncation in listTags().
 */
function syncDocumentTags(docId, tagNames) {
  // Wipe existing junctions first
  removeAllDocumentTags(db, docId);

  if (!tagNames || tagNames.length === 0) return;

  for (const tagName of tagNames) {
    const existing = db
      .prepare('SELECT tag_id FROM tags WHERE tag_name = ?')
      .get(tagName);

    let tagId;
    if (existing) {
      tagId = existing.tag_id;
    } else {
      const tagResult = createTag(db, {
        tag_name: tagName,
        tag_generated_by: 'import' // must satisfy CHECK IN ('user','import')
      });
      tagId = tagResult.success && tagResult.data ? tagResult.data : null;
      if (!tagId) {
        logger.warn('syncDocumentTags: tag creation failed', { tagName, error: tagResult.error, code: tagResult.code });
        continue; // skip for this document, but keep processing others
      }
    }
    addDocumentTag(db, docId, tagId);
  }
}

/**
 * Sync metadata for a document.
 * Deletes existing metadata relationships, then creates/applies new metadata.
 * Uses direct SQL for lookup to avoid the LIMIT 100 truncation in listMetadata().
 */
function syncDocumentMetadata(docId, metadataObj) {
  // Wipe existing junctions first
  removeAllDocumentMetadata(db, docId);

  if (!metadataObj || Object.keys(metadataObj).length === 0) return;

  for (const [key, value] of Object.entries(metadataObj)) {
    const valStr = value !== null && value !== undefined ? String(value) : '';

    // Lookup existing entry by BOTH key AND value (composite identity for junction table)
    const existing = db
      .prepare('SELECT meta_id FROM metadata WHERE meta_key = ? AND meta_value = ?')
      .get(key, valStr);

    let metaId;
    if (existing) {
      metaId = existing.meta_id;
    } else {
      const metaResult = createMetadata(db, {
        meta_key: key,
        meta_value: valStr,
        meta_generated_by: 'import' // must satisfy CHECK IN ('user','import')
      });
      metaId = metaResult.success && metaResult.data ? metaResult.data : null;
      if (!metaId) {
        logger.warn('syncDocumentMetadata: metadata creation failed', { key, value: valStr, error: metaResult.error, code: metaResult.code });
        continue; // skip for this document, but keep processing others
      }
    }
    addDocumentMetadata(db, docId, metaId);
  }
}

/**
 * Pull a single document from Hindsight into architxt.
 *
 * @param {number} serverId - Hindsight server ID
 * @param {string} bankId - Hindsight bank ID
 * @param {string} documentId - Hindsight document ID (ext_id)
 * @returns {Promise<{success: boolean, document?: Object, error?: string, created: boolean}>}
 *   created: true if a new document was inserted, false if an existing one was updated.
 */
export async function pullDocument(serverId, bankId, documentId) {
  logger.info('Pulling document from Hindsight', { serverId, bankId, documentId });

  // 1. Fetch full document from Hindsight
  const hindsightResult = await getHindsightDocument(serverId, bankId, documentId);
  if (!hindsightResult.success) {
    logger.error('Hindsight getDocument failed', { serverId, bankId, documentId, error: hindsightResult.error });
    return { success: false, error: hindsightResult.error };
  }

  const h = hindsightResult.document;
  logger.debug('Hindsight document fetched', {
    id: h.id,
    hasOriginalText: !!h.original_text,
    textLength: h.original_text?.length
  });

  // Extract filename from Hindsight data (filename > title > name > doc-id fallback)
  // Guard against IDs that already end with .md to avoid .md.md growth on re-import.
  function ensureMdExtension(name) {
    if (!name) return 'source.md';
    if (/\.md$/i.test(name)) return name;
    return `${name}.md`;
  }
  const hindsightFilename = ensureMdExtension(h.filename || h.title || h.name || h.id);

  // 2. Check if this ext_id already exists in Architxt
  const existingRows = db.prepare('SELECT doc_id FROM documents WHERE doc_ext_id = ?').all(h.id);
  const existingDocId = existingRows.length > 0 ? existingRows[0].doc_id : null;

  // 3. Resolve context from retain_params.context
  const contextId = resolveContextId(h.retain_params?.context || null);

  // 4. Determine event_date / timestamp
  const rawDate = h.retain_params?.event_date;
  const docTimestamp = (rawDate === null || rawDate === undefined || rawDate === '') ? null : rawDate;

  if (existingDocId) {
    // === SYNC EXISTING DOCUMENT ===
    logger.info('Syncing existing architxt document', { docId: existingDocId, extId: h.id });

    // Build update data (only DB column names)
    const updateData = {
      doc_content: h.original_text || '',
      doc_content_hash: h.content_hash || null,
      doc_timestamp: docTimestamp,
      ctxt_id: contextId,
      doc_updated_at: h.updated_at || new Date().toISOString(),
      doc_filename: hindsightFilename,
    };

    updateDocument(db, existingDocId, updateData);

    // Sync tags and metadata (delete existing, re-apply)
    syncDocumentTags(existingDocId, h.tags || []);
    syncDocumentMetadata(existingDocId, h.document_metadata || null);

    const refreshedResult = getArchitxtDocument(db, existingDocId);
    const refreshed = refreshedResult.success && refreshedResult.data ? refreshedResult.data : null;
    logger.info('Existing document synced successfully', { docId: existingDocId });

    return { success: true, document: refreshed, created: false };
  }

  // === CREATE NEW DOCUMENT ===
  logger.info('Creating new architxt document from Hindsight', { extId: h.id });

  // 4a. Insert the document row first (without source_path since we need the doc_id)
  const newDocData = {
    doc_ext_id: h.id,
    doc_content: h.original_text || '',
    doc_content_hash: h.content_hash || null,
    doc_status: 'processed_extract_success',
    doc_generated_by: 'import',
    doc_timestamp: docTimestamp,
    ctxt_id: contextId,
    doc_created_at: h.created_at || new Date().toISOString(),
    doc_updated_at: h.updated_at || new Date().toISOString(),
    doc_filename: hindsightFilename,
    doc_source_path: 'placeholder'
  };

  const createResult = createDocument(db, newDocData);
  const newDocId = createResult.success && createResult.data ? createResult.data : null;
  if (!newDocId) {
    logger.error('Failed to create document row', { extId: h.id, result: createResult });
    return { success: false, error: 'Failed to create document in database' };
  }
  logger.debug('Document row created', { docId: newDocId });

  // 4b. Write source file to disk using the Hindsight filename (preserves extension)
  const storagePath = config.storage?.path || './documents';
  const buffer = Buffer.from(h.original_text || '', 'utf-8');
  const sourcePath = await writeToStorage(buffer, storagePath, newDocId, hindsightFilename);
  logger.debug('Source file written', { docId: newDocId, sourcePath });

  // 4c. Update the document with the actual source_path
  updateDocument(db, newDocId, {
    doc_filename: hindsightFilename,
    doc_source_path: sourcePath
  });

  // 4d. Sync tags and metadata
  syncDocumentTags(newDocId, h.tags || []);
  syncDocumentMetadata(newDocId, h.document_metadata || null);

  const refreshedResult = getArchitxtDocument(db, newDocId);
  const refreshed = refreshedResult.success && refreshedResult.data ? refreshedResult.data : null;
  logger.info('New document created successfully', { docId: newDocId });

  return { success: true, document: refreshed, created: true };
}
