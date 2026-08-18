/**
 * Templates query handler for research discovery.
 *
 * Lets the user explicitly select one or more derived/template mental models
 * (pre-instantiated over specific entities) and merges their Hindsight outputs.
 *
 * Contract:
 *   Input:  selections: [{ kind: 'template' | 'derived_model', ext_id, name }]
 *   Output: { success, narrative?, graph?, calls_used, error?, code? }
 */

import { getMentalModel as getHindsightMentalModel } from '../../hindsight/mental-models.js';
import { normalizeGraph } from '../../../prompts/normalize-graph.js';
import { createLogger } from '../../../utils/logger.js';

const logger = createLogger('research-handler-templates');

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

export async function handleTemplates(serverId, bankId, intentText, options = {}) {
  if (!serverId || !bankId) {
    return { success: false, error: 'server_id and bank_id are required', code: 'MISSING_PARAMS' };
  }

  const { selections = [], timeoutMs = DEFAULT_TIMEOUT_MS, fetchMentalModel: injectFetch } = options;
  const models = selections.filter(
    (s) => s.kind === 'template' || s.kind === 'derived_model' || s.kind === 'mental_model'
  );

  if (models.length === 0) {
    return {
      success: false,
      error: 'Templates mode requires at least one selected derived model.',
      code: 'MISSING_TEMPLATES',
    };
  }

  logger.info('Templates query', { serverId, bankId, modelCount: models.length });

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
          found: true,
          content: null,
          graph: { nodes: [], edges: [] },
          graph_error: 'Mental-model reflect_response.structured_output is empty or missing.',
        };
      }

      const content = structuredOutput;
      const narrative = typeof content.narrative === 'string' ? content.narrative : '';
      const graph = content.graph && typeof content.graph === 'object' ? content.graph : { nodes: [], edges: [] };
      const tables = Array.isArray(content.tables) ? content.tables : [];
      const diagrams = Array.isArray(content.diagrams) ? content.diagrams : [];
      const graphNormalized = normalizeGraph(graph, { source: 'template_model' });

      return {
        ext_id: extId,
        name,
        found: true,
        content,
        narrative,
        graph: graphNormalized,
        tables,
        diagrams,
        graph_error: undefined,
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
    if (item.narrative) {
      narratives.push(`## ${item.name || item.ext_id}\n\n${item.narrative}`);
    } else if (item.diagrams?.length > 0 || item.tables?.length > 0 || item.graph?.nodes?.length > 0 || item.graph?.edges?.length > 0) {
      narratives.push(`## ${item.name || item.ext_id}\n\nNo narrative text provided.`);
    } else if (item.content != null) {
      const fallback = typeof item.content === 'string' ? item.content : JSON.stringify(item.content, null, 2);
      narratives.push(`## ${item.name || item.ext_id}\n\n${fallback}`);
    }
    if (item.graph) {
      if (item.graph.nodes.length > 0 || item.graph.edges.length > 0) {
        graphs.push(item.graph);
      } else if (item.graph_error) {
        errors.push({ model: item.name || item.ext_id, error: item.graph_error });
      }
    }
    if (item.tables && item.tables.length > 0) {
      tables.push(...item.tables);
    }
    if (item.diagrams && item.diagrams.length > 0) {
      diagrams.push(...item.diagrams);
    }
  }

  let narrative = narratives.join('\n\n');
  if (narrative) {
    narrative = `# Templates Query\n\n${narrative}`;
  } else if (graphs.length > 0 || tables.length > 0 || diagrams.length > 0) {
    narrative = `Found template data for ${graphs.length} selected model(s).`;
  }

  if (!narrative && errors.length > 0) {
    narrative = 'No template content could be retrieved.';
  }

  const graph = graphs.length > 0 ? mergeGraphs(graphs) : { nodes: [], edges: [] };

  return {
    success: true,
    narrative,
    graph,
    tables,
    diagrams,
    calls_used: ['list_template_models'],
    errors: errors.length > 0 ? errors : undefined,
  };
}
