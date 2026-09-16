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
    detail: 'full',
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

      const structuredOutput = result.mentalModel.reflect_response?.structured_output ?? null;
      if (!structuredOutput || typeof structuredOutput !== 'object') {
        return {
          ext_id: extId,
          name,
          content: null,
          found: true,
          graph: { nodes: [], edges: [] },
          graph_error: 'Mental-model reflect_response.structured_output is empty or missing.',
        };
      }

      const content = structuredOutput;
      const graph = content.graph && typeof content.graph === 'object' ? content.graph : { nodes: [], edges: [] };
      const rawNarratives = Array.isArray(content.narratives)
        ? content.narratives
          .filter((n) => n && typeof n === 'object' && !Array.isArray(n) && typeof n.narrative === 'string')
        : [];
      const legacyNarrative = typeof content.narrative === 'string' ? content.narrative : '';
      const narratives = rawNarratives.length > 0
        ? rawNarratives.map((n) => ({
          narrative_name: typeof n.narrative_name === 'string' ? n.narrative_name : '',
          narrative: n.narrative,
        }))
        : legacyNarrative ? [{ narrative_name: '', narrative: legacyNarrative }] : [];
      const tables = Array.isArray(content.tables) ? content.tables : [];
      const diagrams = Array.isArray(content.diagrams) ? content.diagrams : [];

      return {
        ext_id: extId,
        name,
        content,
        found: true,
        narratives,
        graph,
        tables,
        diagrams,
        errors: undefined,
      };
    }),
  );

  const narratives = [];
  const graphs = [];
  const tables = [];
  const diagrams = [];
  const errors = [];

  for (const item of fetched) {
    if (!item.found) {
      errors.push({ model: item.name || item.ext_id, error: item.error || 'Not found' });
      continue;
    }
    if (item.narratives && item.narratives.length > 0) {
      for (const n of item.narratives) {
        if (!n.narrative) continue;
        const name = n.narrative_name || `${item.name || item.ext_id}`;
        narratives.push({ narrative_name: name, narrative: n.narrative });
      }
    } else if (item.content) {
      const fallback = typeof item.content === 'string' ? item.content : JSON.stringify(item.content, null, 2);
      narratives.push({ narrative_name: item.name || item.ext_id, narrative: fallback });
    }
    if (item.graph && (item.graph.nodes.length > 0 || item.graph.edges.length > 0)) {
      graphs.push(item.graph);
    }
    if (item.tables && item.tables.length > 0) {
      tables.push(...item.tables);
    }
    if (item.diagrams && item.diagrams.length > 0) {
      diagrams.push(...item.diagrams);
    }
    if (item.errors) {
      for (const err of item.errors) {
        errors.push({ model: item.name || item.ext_id, error: err });
      }
    }
  }

  const graph = graphs.length > 0 ? mergeGraphs(graphs) : { nodes: [], edges: [] };

  return {
    success: true,
    narratives,
    graph,
    tables,
    diagrams,
    calls_used: ['list_mental_models'],
    errors: errors.length > 0 ? errors : undefined,
  };
}
