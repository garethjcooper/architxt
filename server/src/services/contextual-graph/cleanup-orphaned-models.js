import { createLogger } from '../../utils/logger.js';
import { extractModelRefsFromDb } from './graph-model-refs.js';
import { deleteMentalModel } from '../hindsight/mental-models.js';
import { clearLocalModelData } from './cleanup-disallowed-models.js';
import { deriveSpecForRef } from './specs.js';
import { getRoleScopeMap } from '../../db/crud/template-roles.js';

const logger = createLogger('contextual-graph-orphan-cleanup');

/**
 * Delete contextual-graph mental models that still exist locally (and/or in
 * Hindsight) but whose backing node/edge/seed no longer qualifies for a spec.
 *
 * This is the attachment-based cleanup half of the sync lifecycle:
 * - After importing the latest skeleton from Hindsight, every local model_ref is
 *   re-derived with `deriveSpecForRef`.
 * - If the backing node/edge is missing, the node became a candidate, or the edge
 *   was demoted/disconnected, the spec returns `null` and we remove the model.
 * - We delete from Hindsight and strip/clear local applied data in the same way
 *   `cleanupDisallowedModels` does.
 *
 * This catches the "edge role model created in error / no longer attached" case
 * that disallowed-role cleanup cannot.
 *
 * @param {Object} db
 * @param {number} serverId
 * @param {string} bankId
 * @param {Object} [options]
 * @param {Function} [options.deleteFromHindsight] - override for testing
 * @returns {Promise<{success: boolean, deleted?: string[], failed?: {ext_id: string, error: string}[], cleared?: {nodes: number, edges: number}, skipped?: number, error?: string, code?: string}>}
 */
export async function cleanupOrphanedModels(db, serverId, bankId, options = {}) {
  if (!serverId || !bankId) {
    return { success: false, error: 'server_id and bank_id are required', code: 'MISSING_PARAMS' };
  }

  const scopeMap = getRoleScopeMap(db);
  const knownRoleIds = new Set(scopeMap.keys());

  // Extract only refs for known contextual roles.
  const refs = await extractModelRefsFromDb(db, serverId, bankId, {
    filterFn: ({ role }) => knownRoleIds.has(role),
  });

  const orphanedExtIds = new Set();
  const keepExtIds = new Set();

  for (const extId of refs.extIds) {
    const ref = refs.byExtId.get(extId);
    const spec = await deriveSpecForRef(db, serverId, bankId, ref);
    if (!spec) {
      orphanedExtIds.add(extId);
    } else {
      keepExtIds.add(extId);
    }
  }

  logger.info('Cleaning up orphaned contextual models', {
    serverId,
    bankId,
    totalRefs: refs.extIds.length,
    orphaned: orphanedExtIds.size,
    kept: keepExtIds.size,
  });

  const deleteFn = options.deleteFromHindsight || deleteMentalModel;

  const deleted = [];
  const failed = [];
  for (const extId of orphanedExtIds) {
    const result = await deleteFn(serverId, bankId, extId);
    if (result.success) {
      deleted.push(extId);
    } else {
      failed.push({ ext_id: extId, error: result.error });
    }
  }

  // Always strip local refs and generated data for ids we attempted to delete,
  // matching the disallowed-cleanup behavior.
  const cleared = await clearLocalModelData(db, serverId, bankId, orphanedExtIds, refs, scopeMap);

  return {
    success: true,
    deleted,
    failed,
    cleared,
    skipped: keepExtIds.size,
  };
}

/**
 * Convenience predicate used by the sync job to decide whether a remote model
 * id is an orphan based solely on whether a matching local ref would re-derive.
 * Currently unused, but exposed for future stages that need to reason about
 * remote-only orphan state.
 */
export async function isOrphanedExtId(db, serverId, bankId, extId, _options = {}) {
  const scopeMap = getRoleScopeMap(db);
  const knownRoleIds = new Set(scopeMap.keys());

  const refs = await extractModelRefsFromDb(db, serverId, bankId, {
    filterFn: ({ role, ext_id: id }) => knownRoleIds.has(role) && id === extId,
  });

  if (!refs.byExtId.has(extId)) {
    // No local ref exists; we cannot determine attachment without a remote
    // lookup. Treat as not an orphan to avoid deleting user mental models.
    return false;
  }

  const ref = refs.byExtId.get(extId);
  const spec = await deriveSpecForRef(db, serverId, bankId, ref);
  return spec === null;
}
