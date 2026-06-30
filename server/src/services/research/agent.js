import { createLogger } from '../../utils/logger.js';
import { dispatchHandler } from './handlers/index.js';
import { updateStep } from '../../db/crud/research.js';

const logger = createLogger('research-agent');

const EMPTY_CANVAS = {
  graph: { nodes: [], edges: [] },
};

function buildCallLog(handlerResult, options, duration_ms) {
  const calls = handlerResult.calls || handlerResult.calls_used || [];
  return calls.map((tool) => {
    const isString = typeof tool === 'string';
    const mode = isString ? tool : (tool.mode || tool.tool || 'unknown');
    return {
      tool: mode,
      mode,
      status: handlerResult.success ? 'success' : 'failure',
      duration_ms: isString ? duration_ms : (tool.duration_ms ?? duration_ms),
      error: isString ? undefined : tool.error,
      code: isString ? undefined : tool.code,
      request_payload_chars: isString ? 0 : (tool.request_payload_chars ?? 0),
      prompt_text: isString ? (options.query || '') : (tool.prompt_text || options.query || ''),
      response_text: isString ? undefined : tool.response_text,
      response_summary: isString ? undefined : tool.response_summary,
      model: isString ? undefined : tool.model,
      usage: isString ? undefined : tool.usage,
      request: isString ? undefined : tool.request,
    };
  });
}

/**
 * Run a single research discovery step.
 *
 * Dispatches to a query-depth handler (prebuilt, recall, reflect, synthesize). The handler returns { narrative, graph }. We store only the narrative
 * in rstep_synthesis; findings/seams are no longer part of the contract.
 */
export async function runDiscoverStep(params) {
  const {
    db,
    serverId,
    bankId,
    queryDepth = 'prebuilt',
    intentText,
    options = {},
    rsId,
    rstepId,
  } = params;

  const calls = [];

  const failStep = async (error, code) => {
    try {
      if (db && rstepId) {
        await updateStep(db, rstepId, {
          rstep_status: 'failed',
          rstep_error_message: error,
          rstep_calls: calls,
        });
      }
    } catch (updateErr) {
      logger.error('Failed to mark step failed', { error: updateErr.message, rstepId });
    }
    return { success: false, error, code };
  };

  if (!db) return failStep('db is required', 'MISSING_DB');
  if (!serverId) return failStep('serverId is required', 'MISSING_SERVER');
  if (!bankId) return failStep('bankId is required', 'MISSING_BANK');
  if (!intentText) return failStep('intentText is required', 'MISSING_INTENT');
  if (!rsId || !rstepId) return failStep('rsId and rstepId are required for async step tracking', 'MISSING_STEP_CONTEXT');

  try {
    const start = performance.now();
    const handlerOptions = queryDepth === 'prebuilt' ? { ...options, dimension: options.dimension || 'interface' } : options;
    const handlerResult = await dispatchHandler(queryDepth, serverId, bankId, intentText, handlerOptions);
    const duration_ms = Math.round(performance.now() - start);

    calls.push(...buildCallLog(handlerResult, options, duration_ms));

    if (!handlerResult.success) {
      return failStep(handlerResult.error, handlerResult.code || 'HANDLER_FAILED');
    }

    const narrative = handlerResult.narrative || '';
    const canvas = {
      ...EMPTY_CANVAS,
      graph: handlerResult.graph || { nodes: [], edges: [] },
    };

    await updateStep(db, rstepId, {
      rstep_canvas_state: canvas,
      rstep_synthesis: { narrative },
      rstep_tool_calls_used: calls.length,
      rstep_calls: calls,
      rstep_status: 'completed',
      rstep_error_message: null,
    });

    return {
      success: true,
      data: {
        synthesis: { narrative },
        canvas,
        calls,
        tool_calls_used: calls.length,
      },
    };
  } catch (err) {
    logger.error('runDiscoverStep failed', { error: err.message, stack: err.stack, rsId, rstepId });
    try {
      await updateStep(db, rstepId, {
        rstep_status: 'failed',
        rstep_error_message: err.message || 'Unknown agent error',
        rstep_calls: calls,
      });
    } catch (updateErr) {
      logger.error('Failed to update step status after error', { error: updateErr.message, rstepId });
    }
    return { success: false, error: err.message, code: 'AGENT_RUN_FAILED' };
  }
}

export default {
  runDiscoverStep,
};
