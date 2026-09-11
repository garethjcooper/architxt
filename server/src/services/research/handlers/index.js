import { handlePrebuilt } from './prebuilt.js';
import { handleRecall } from './recall.js';
import { handleReflect } from './reflect.js';
import { handleSynthesize } from './synthesize.js';
import { handleModels } from './models.js';
import { handleTemplates } from './templates.js';

export const QUERY_DEPTHS = ['prebuilt', 'recall', 'reflect', 'synthesize', 'models', 'templates'];

export function isValidQueryDepth(value) {
  return QUERY_DEPTHS.includes(value);
}

export async function dispatchHandler(queryDepth, serverId, bankId, query, options = {}, db) {
  switch (queryDepth) {
    case 'prebuilt':
      return handlePrebuilt(serverId, bankId, query, options, db);
    case 'recall':
      return handleRecall(serverId, bankId, query, options, db);
    case 'reflect':
      return handleReflect(serverId, bankId, query, options, db);
    case 'synthesize':
      return handleSynthesize(serverId, bankId, query, options, db);
    case 'models':
      return handleModels(serverId, bankId, query, options, db);
    case 'templates':
      return handleTemplates(serverId, bankId, query, options, db);
    default:
      return {
        success: false,
        error: `Unknown query_depth: ${queryDepth}`,
        code: 'INVALID_QUERY_DEPTH',
      };
  }
}
