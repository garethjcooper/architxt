import { handlePrebuilt } from './prebuilt.js';
import { handleRecall } from './recall.js';
import { handleReflect } from './reflect.js';
import { handleSynthesize } from './synthesize.js';

export const QUERY_DEPTHS = ['prebuilt', 'recall', 'reflect', 'synthesize'];

export function isValidQueryDepth(value) {
  return QUERY_DEPTHS.includes(value);
}

export async function dispatchHandler(queryDepth, serverId, bankId, query, options = {}) {
  switch (queryDepth) {
    case 'prebuilt':
      return handlePrebuilt(serverId, bankId, query, options);
    case 'recall':
      return handleRecall(serverId, bankId, query, options);
    case 'reflect':
      return handleReflect(serverId, bankId, query, options);
    case 'synthesize':
      return handleSynthesize(serverId, bankId, query, options);
    default:
      return {
        success: false,
        error: `Unknown query_depth: ${queryDepth}`,
        code: 'INVALID_QUERY_DEPTH',
      };
  }
}
