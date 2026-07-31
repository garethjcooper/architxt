/**
 * Models query handler for research discovery.
 *
 * Lets the user explicitly select one or more non-template mental models from
 * architxt, fetches each model's content from Hindsight by ext_id, and merges
 * the outputs according to each model's declared `returns` and `concatenation`
 * metadata.
 *
 * Contract:
 *   Input:  selections: [{ kind: 'model', id, ext_id, name }]
 *   Output: { success, narrative?, graph?, calls_used, error?, code? }
 */

import { getMentalModel as getHindsightMentalModel } from '../../hindsight/mental-models.js';
import { parseGraphResponse } from '../../../prompts/parse-graph-response.js';
import { createLogger } from '../../../utils/logger.js';

const logger = createLogger('research-handler-models');

const DEFAULT_TIMEOUT_MS = 15000;

function mergeGraphs(graphs) {
  const nodeById = new Map();
  const edgeKeys = new Set();
  const edges = [];

  for (const graph of graphs) {
    if (!graph) continue;
    for (const n of graph.nodes || []) {
      if (!nodeById.has(n.id)) nodeById.set(n.id, n);
    }
    for (const e of graph.edges || []) {
      const key = e.id || `${e.from}|${e.to}|${e.type}`;
      if (edgeKeys.has(key)) continue;
      edgeKeys.add(key);
      edges.push(e);
    }
  }

  return {
    nodes: Array.from(nodeById.values()),
    edges,
  };
}

export async function handleModels(serverId, bankId, intentText, options = {}) {
  if (!serverId || !bankId) {
    return { success: false, error: 'server_id and bank_id are required', code: 'MISSING_PARAMS' };
  }

  const { selections = [], timeoutMs = DEFAULT_TIMEOUT_MS, fetchMentalModel: injectFetch } = options;
  const models = selections.filter((s) => s.kind === 'model' || s.kind === 'mental_model');

  if (models.length === 0) {
    return {
      success: false,
      error: 'Models mode requires at least one selected mental model.',
      code: 'MISSING_MODELS',
    };
  }

  logger.info('Models query', { serverId, bankId, modelCount: models.length });

  const fetchMentalModel = injectFetch || ((extId) => getHindsightMentalModel(serverId, bankId, extId, {
    detail: 'content',
    timeoutMs,
  }));

  const fetched = await Promise.all(
    models.map(async (selection) => {
      const extId = selection.ext_id || selection.id;
      const name = selection.name || extId || '(unknown)';
      if (!extId) {
        return {
          ext_id: extId,
          name,
          found: false,
          error: 'Selection has no ext_id or id',
        };
      }

      const result = await fetchMentalModel(extId);

      if (!result.success || !result.mentalModel) {
        return {
          ext_id: extId,
          name,
          found: false,
          error: result.error || 'Hindsight returned empty mental model',
        };
      }

      const content = result.mentalModel.content ?? null;
      if (!content) {
        return {
          ext_id: extId,
          name,
          found: true,
          content: null,
          graph: { nodes: [], edges: [] },
          graph_error: 'Mental-model content is empty or missing.',
        };
      }

      const { graph, error: graphError } = parseGraphResponse(content, {
        mode: 'graph-known',
        expectGraph: true,
        defaultSource: 'mental_model',
      });

      return {
        ext_id: extId,
        name,
        found: true,
        content,
        concatenation: selection.concatenation,
        graph,
        graph_error: graphError,
      };
    }),
  );

  const narratives = [];
  const graphs = [];
  const errors = [];

  for (const item of fetched) {
    if (!item.found) {
      errors.push({ model: item.name || item.ext_id, error: item.error || 'Not found' });
      continue;
    }
    if (item.content) {
      narratives.push(`## ${item.name || item.ext_id}\n\n${item.content}`);
    }
    if (item.graph) {
      if (item.graph.nodes.length > 0 || item.graph.edges.length > 0) {
        graphs.push(item.graph);
      } else if (item.graph_error) {
        errors.push({ model: item.name || item.ext_id, error: item.graph_error });
      }
    }
  }

  let narrative = narratives.join('\n\n');
  if (narrative) {
    narrative = `# Models Query\n\n${narrative}`;
  } else if (graphs.length > 0) {
    narrative = `Found model data for ${graphs.length} selected model(s).`;
  }

  if (!narrative && errors.length > 0) {
    narrative = 'No model content could be retrieved.';
  }

  const graph = graphs.length > 0 ? mergeGraphs(graphs) : { nodes: [], edges: [] };

  return {
    success: true,
    narrative,
    graph,
    calls_used: ['list_mental_models'],
    errors: errors.length > 0 ? errors : undefined,
  };
}
