/**
 * Hindsight Service Client - Memory Evidence Resolution
 *
 * Resolves a list of memory ids (UUID facts or mental-model names) into the
 * source world memories that back them, then aggregates the referenced chunks
 * by document so the UI can show evidence for a graph element / mental model.
 */

import { createLogger } from '../../utils/logger.js';
import { getServerConfig } from './config.js';

const logger = createLogger('hindsight-evidence');

const DEFAULT_TIMEOUT_MS = 60000;

function buildHeaders(serverConfig) {
  const headers = { 'Content-Type': 'application/json' };
  if (serverConfig.apiKey) {
    headers.Authorization = `Bearer ${serverConfig.apiKey}`;
  }
  return headers;
}

function fetchWithTimeout(url, fetchOptions, timeoutMs = DEFAULT_TIMEOUT_MS) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  return fetch(url, { ...fetchOptions, signal: controller.signal }).finally(() => clearTimeout(timeoutId));
}

async function resolveServer(serverId) {
  const configResult = await getServerConfig(serverId);
  if (!configResult.success) return configResult;
  const { serviceUrl, apiKey, apiVersion } = configResult.config;
  return {
    success: true,
    serviceUrl,
    config: { serviceUrl, apiKey, apiVersion },
  };
}

function buildBankUrl(serviceUrl, bankId, path) {
  return `${serviceUrl}/v1/default/banks/${encodeURIComponent(bankId)}${path}`;
}

/**
 * GET /v1/default/banks/{bank_id}/memories/{memory_id}
 *
 * Returns the raw Hindsight memory payload, or an error shape the caller can
 * use to decide whether to fall back to mental-model lookup.
 *
 * @param {number} serverId
 * @param {string} bankId
 * @param {string} memoryId
 * @returns {Promise<{success: boolean, memory?: object, notFound?: boolean, error?: string, code?: string}>}
 */
export async function getMemory(serverId, bankId, memoryId) {
  const resolved = await resolveServer(serverId);
  if (!resolved.success) return resolved;

  const url = buildBankUrl(resolved.serviceUrl, bankId, `/memories/${encodeURIComponent(memoryId)}`);

  try {
    const response = await fetchWithTimeout(url, {
      method: 'GET',
      headers: buildHeaders(resolved.config),
    });

    if (response.status === 404) {
      const errorText = await response.text();
      logger.info('Hindsight getMemory not found', { serverId, bankId, memoryId, errorText });
      return { success: false, notFound: true, error: `HTTP ${response.status}: ${errorText}`, code: 'HINDSIGHT_MEMORY_NOT_FOUND' };
    }

    if (!response.ok) {
      const errorText = await response.text();
      logger.error('Hindsight getMemory failed', { serverId, bankId, memoryId, status: response.status, error: errorText });
      return { success: false, error: `HTTP ${response.status}: ${errorText}`, code: 'HINDSIGHT_MEMORY_FAILED' };
    }

    const memory = await response.json();
    logger.info('Hindsight getMemory OK', { serverId, bankId, memoryId, type: memory.type });
    return { success: true, memory };
  } catch (error) {
    logger.error('Hindsight getMemory error', { serverId, bankId, memoryId, error: error.message });
    return { success: false, error: error.message, code: 'HINDSIGHT_MEMORY_ERROR' };
  }
}

/**
 * GET /v1/default/chunks/{chunk_id}
 *
 * @param {number} serverId
 * @param {string} chunkId
 * @returns {Promise<{success: boolean, chunk?: object, error?: string, code?: string}>}
 */
export async function getChunk(serverId, chunkId) {
  const resolved = await resolveServer(serverId);
  if (!resolved.success) return resolved;

  const url = `${resolved.serviceUrl}/v1/default/chunks/${encodeURIComponent(chunkId)}`;

  try {
    const response = await fetchWithTimeout(url, {
      method: 'GET',
      headers: buildHeaders(resolved.config),
    });

    if (!response.ok) {
      const errorText = await response.text();
      logger.error('Hindsight getChunk failed', { serverId, chunkId, status: response.status, error: errorText });
      return { success: false, error: `HTTP ${response.status}: ${errorText}`, code: 'HINDSIGHT_CHUNK_FAILED' };
    }

    const chunk = await response.json();
    logger.info('Hindsight getChunk OK', { serverId, chunkId, documentId: chunk.document_id });
    return { success: true, chunk };
  } catch (error) {
    logger.error('Hindsight getChunk error', { serverId, chunkId, error: error.message });
    return { success: false, error: error.message, code: 'HINDSIGHT_CHUNK_ERROR' };
  }
}

/**
 * GET /v1/default/banks/{bank_id}/mental-models/{ext_id}
 *
 * Reuses the existing mental-model client but requests full detail so the
 * response includes the based_on memory lists used for evidence resolution.
 *
 * @param {number} serverId
 * @param {string} bankId
 * @param {string} extId
 * @returns {Promise<{success: boolean, mentalModel?: object, notFound?: boolean, error?: string, code?: string}>}
 */
export async function getMentalModelForEvidence(serverId, bankId, extId) {
  const { getMentalModel } = await import('./mental-models.js');
  return getMentalModel(serverId, bankId, extId, { detail: 'full' });
}

function isWorldMemory(memory) {
  return memory && memory.type === 'world';
}

function isObservationMemory(memory) {
  return memory && memory.type === 'observation';
}

/**
 * Collect distinct world memory ids that back a single queried memory id.
 *
 * Resolution order per queried id:
 *   1. GET /memories/{id}
 *      - world  -> add id
 *      - observation -> add each source_memory_ids entry that is a world
 *                      (observations nested inside observations are reported
 *                       but not expanded)
 *      - experience / other -> ignore
 *   2. If memory not found, GET /mental-models/{id}?detail=full
 *      - add based_on.world ids
 *      - add based_on.observation ids, then resolve each observation to its
 *        source world ids
 *
 * @param {number} serverId
 * @param {string} bankId
 * @param {string} memoryId
 * @returns {Promise<{success: boolean, worldIds: Set<string>, observationsSkipped: string[], error?: string}>}
 */
async function resolveWorldIds(serverId, bankId, memoryId) {
  const worldIds = new Set();
  const observationsSkipped = [];
  let memoryType = null;

  const memoryResult = await getMemory(serverId, bankId, memoryId);
  if (memoryResult.success) {
    const memory = memoryResult.memory;
    memoryType = memory.type || null;
    if (isWorldMemory(memory)) {
      worldIds.add(memoryId);
    } else if (isObservationMemory(memory)) {
      const sourceIds = Array.isArray(memory.source_memory_ids) ? memory.source_memory_ids : [];
      for (const sourceId of sourceIds) {
        const sourceResult = await getMemory(serverId, bankId, sourceId);
        if (sourceResult.success && isWorldMemory(sourceResult.memory)) {
          worldIds.add(sourceId);
        } else if (sourceResult.success && isObservationMemory(sourceResult.memory)) {
          observationsSkipped.push(sourceId);
        }
      }
    }
    return { success: true, worldIds, observationsSkipped, memoryType };
  }

  // Memory not found -> try mental model lookup.
  const mmResult = await getMentalModelForEvidence(serverId, bankId, memoryId);
  if (!mmResult.success) {
    return {
      success: false,
      worldIds,
      observationsSkipped,
      memoryType,
      error: `Unable to resolve memory id '${memoryId}': ${memoryResult.error || mmResult.error}`,
    };
  }

  memoryType = 'mental_model';

  const basedOn = mmResult.mentalModel?.based_on || {};
  const directWorldIds = Array.isArray(basedOn.world) ? basedOn.world : [];
  for (const id of directWorldIds) {
    worldIds.add(id);
  }

  const observationIds = Array.isArray(basedOn.observation) ? basedOn.observation : [];
  for (const observationId of observationIds) {
    const obsResult = await getMemory(serverId, bankId, observationId);
    if (obsResult.success && isWorldMemory(obsResult.memory)) {
      worldIds.add(observationId);
    } else if (obsResult.success && isObservationMemory(obsResult.memory)) {
      const sourceIds = Array.isArray(obsResult.memory.source_memory_ids) ? obsResult.memory.source_memory_ids : [];
      for (const sourceId of sourceIds) {
        const sourceResult = await getMemory(serverId, bankId, sourceId);
        if (sourceResult.success && isWorldMemory(sourceResult.memory)) {
          worldIds.add(sourceId);
        } else if (sourceResult.success && isObservationMemory(sourceResult.memory)) {
          observationsSkipped.push(sourceId);
        }
      }
    }
  }

  return { success: true, worldIds, observationsSkipped, memoryType };
}

/**
 * Build the evidence aggregate for a list of queried memory ids.
 *
 * Response shape per queried id:
 * {
 *   memory_id: string,
 *   document_count: number,
 *   document_list: string[],
 *   documents: [
 *     {
 *       document_id: string,
 *       document_referenced_count: number,
 *       chunks: [
 *         {
 *           chunk_id: string,
 *           chunk_index: number,
 *           chunk_text: string,
 *           memory_ids: string[],
 *         }
 *       ]
 *     }
 *   ],
 *   unresolved_error?: string,
 *   observations_skipped: string[]
 * }
 *
 * @param {number} serverId
 * @param {string} bankId
 * @param {string[]} memoryIds
 * @returns {Promise<{success: boolean, evidence?: object[], errors?: string[], error?: string}>}
 */
export async function resolveMemoryEvidence(serverId, bankId, memoryIds) {
  const errors = [];
  const evidence = [];

  for (const memoryId of memoryIds) {
    const resolved = await resolveWorldIds(serverId, bankId, memoryId);

    const perQueryEvidence = {
      memory_id: memoryId,
      memory_type: resolved.memoryType,
      document_count: 0,
      document_list: [],
      documents: [],
      observations_skipped: resolved.observationsSkipped,
    };

    if (!resolved.success) {
      perQueryEvidence.unresolved_error = resolved.error;
      errors.push(resolved.error);
    }

    if (resolved.worldIds.size === 0) {
      evidence.push(perQueryEvidence);
      continue;
    }

    // Fetch world memory details and chunk text once per chunk_id.
    const documentMap = new Map(); // document_id -> { referencedCount, chunkMap }
    const chunkTextCache = new Map(); // chunk_id -> { chunk_index, chunk_text }

    for (const worldId of resolved.worldIds) {
      const worldResult = await getMemory(serverId, bankId, worldId);
      if (!worldResult.success) {
        logger.warn('Failed to fetch resolved world memory', { serverId, bankId, memoryId, worldId, error: worldResult.error });
        continue;
      }

      const world = worldResult.memory;
      const documentId = world.document_id;
      const chunkId = world.chunk_id;
      if (!documentId || !chunkId) {
        logger.warn('World memory missing document_id or chunk_id', { serverId, bankId, memoryId, worldId });
        continue;
      }

      if (!documentMap.has(documentId)) {
        documentMap.set(documentId, { referencedCount: 0, chunkMap: new Map() });
      }
      const docEntry = documentMap.get(documentId);
      docEntry.referencedCount += 1;

      if (!docEntry.chunkMap.has(chunkId)) {
        let chunkIndex = null;
        let chunkText = '';
        if (chunkTextCache.has(chunkId)) {
          const cached = chunkTextCache.get(chunkId);
          chunkIndex = cached.chunk_index;
          chunkText = cached.chunk_text;
        } else {
          const chunkResult = await getChunk(serverId, chunkId);
          if (chunkResult.success) {
            chunkIndex = chunkResult.chunk.chunk_index ?? null;
            chunkText = chunkResult.chunk.chunk_text ?? '';
            chunkTextCache.set(chunkId, { chunk_index: chunkIndex, chunk_text: chunkText });
          } else {
            logger.warn('Failed to fetch chunk', { serverId, memoryId, worldId, chunkId, error: chunkResult.error });
          }
        }

        docEntry.chunkMap.set(chunkId, {
          chunk_id: chunkId,
          chunk_index: chunkIndex,
          chunk_text: chunkText,
          memory_ids: [],
          memory_types: {},
        });
      }

      const chunkEntry = docEntry.chunkMap.get(chunkId);
      if (!chunkEntry.memory_ids.includes(worldId)) {
        chunkEntry.memory_ids.push(worldId);
      }
      if (world.type) {
        chunkEntry.memory_types[worldId] = world.type;
      }
    }

    const documentList = [];
    const documents = [];
    for (const [documentId, docEntry] of documentMap) {
      documentList.push(documentId);
      documents.push({
        document_id: documentId,
        document_referenced_count: docEntry.referencedCount,
        chunks: Array.from(docEntry.chunkMap.values()).sort((a, b) => {
          if (a.chunk_index === null) return 1;
          if (b.chunk_index === null) return -1;
          return a.chunk_index - b.chunk_index;
        }),
      });
    }

    perQueryEvidence.document_count = documentList.length;
    perQueryEvidence.document_list = documentList;
    perQueryEvidence.documents = documents
      .map((doc) => ({
        document_id: doc.document_id,
        document_referenced_count: doc.document_referenced_count,
        chunks: doc.chunks.map((chunk) => ({
          chunk_id: chunk.chunk_id,
          chunk_index: chunk.chunk_index,
          memory_ids: chunk.memory_ids,
          memory_types: chunk.memory_types,
          // chunk_text is intentionally omitted here; use the top-level
          // rollup document chunks for the full text to keep payloads light.
        })),
      }))
      .sort((a, b) => a.document_id.localeCompare(b.document_id));

    // Pass the full-chunk documents forward for the cross-query rollup.
    evidence.push({ ...perQueryEvidence, _fullDocuments: documents });
  }

  // Build a top-level cross-query document rollup from the full-chunk data.
  const globalDocumentMap = new Map(); // document_id -> { queriedMemoryIds: Set, supportingMemoryIds: Set, chunkMap: Map }
  for (const entry of evidence) {
    const fullDocuments = entry._fullDocuments || [];
    for (const doc of fullDocuments) {
      if (!globalDocumentMap.has(doc.document_id)) {
        globalDocumentMap.set(doc.document_id, {
          queriedMemoryIds: new Set(),
          supportingMemoryIds: new Set(),
          chunkMap: new Map(),
        });
      }
      const globalDoc = globalDocumentMap.get(doc.document_id);
      globalDoc.queriedMemoryIds.add(entry.memory_id);
      for (const chunk of doc.chunks) {
        for (const worldId of chunk.memory_ids) {
          globalDoc.supportingMemoryIds.add(worldId);
        }
        if (!globalDoc.chunkMap.has(chunk.chunk_id)) {
          globalDoc.chunkMap.set(chunk.chunk_id, {
            chunk_id: chunk.chunk_id,
            chunk_index: chunk.chunk_index,
            chunk_text: chunk.chunk_text,
            memory_ids: [...chunk.memory_ids],
            memory_types: { ...(chunk.memory_types || {}) },
            queried_memory_ids: new Set([entry.memory_id]),
          });
        } else {
          const globalChunk = globalDoc.chunkMap.get(chunk.chunk_id);
          for (const worldId of chunk.memory_ids) {
            if (!globalChunk.memory_ids.includes(worldId)) {
              globalChunk.memory_ids.push(worldId);
            }
            if (chunk.memory_types?.[worldId]) {
              globalChunk.memory_types[worldId] = chunk.memory_types[worldId];
            }
          }
          globalChunk.queried_memory_ids.add(entry.memory_id);
        }
      }
    }
  }

  // Remove the internal full-document carrier before returning.
  const publicEvidence = evidence.map(({ _fullDocuments, ...rest }) => rest);

  const globalDocumentList = [];
  const globalDocuments = [];
  for (const [documentId, docEntry] of globalDocumentMap) {
    globalDocumentList.push(documentId);
    const chunks = Array.from(docEntry.chunkMap.values()).map((chunk) => ({
      chunk_id: chunk.chunk_id,
      chunk_index: chunk.chunk_index,
      chunk_text: chunk.chunk_text,
      memory_ids: chunk.memory_ids,
      memory_types: chunk.memory_types,
      queried_memory_ids: Array.from(chunk.queried_memory_ids).sort(),
    })).sort((a, b) => {
      if (a.chunk_index === null) return 1;
      if (b.chunk_index === null) return -1;
      return a.chunk_index - b.chunk_index;
    });

    globalDocuments.push({
      document_id: documentId,
      queried_memory_count: docEntry.queriedMemoryIds.size,
      supporting_memory_count: docEntry.supportingMemoryIds.size,
      queried_memory_ids: Array.from(docEntry.queriedMemoryIds).sort(),
      chunks,
    });
  }

  const rollup = {
    document_count: globalDocumentList.length,
    document_list: globalDocumentList,
    documents: globalDocuments.sort((a, b) => a.document_id.localeCompare(b.document_id)),
  };

  return { success: true, evidence: publicEvidence, rollup, errors: errors.length > 0 ? errors : undefined };
}
