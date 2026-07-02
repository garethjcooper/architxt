import { Router } from 'express';
import { db } from '../db/connection.js';
import { createLogger } from '../utils/logger.js';
import { sendResponse, validateId } from '../utils/route-helpers.js';
import { mapErrorToStatus } from '../utils/db-helpers.js';
import { runDiscoverStep } from '../services/research/agent.js';
import { normalizeHindsightGraph } from '../services/research/halo-graph.js';
import { isValidQueryDepth } from '../services/research/handlers/index.js';
import {
  createSession,
  updateSessionCurrentStep,
  createStep,
  updateStep,
  getSession,
  getSessionWithCurrentStep,
  listStepsForSession,
  getStep,
  deleteStepWithSession,
  listSessionsByBank,
  updateSession,
  deleteSessionWithSteps,
} from '../db/crud/research.js';

import { discoverMentalModelsByDimensions, listEligibleMentalModels } from '../services/research/mental-model-discovery.js';
import { runPrebuiltResearch } from '../services/research/prebuilt-research.js';

const logger = createLogger('research-route');
const router = Router();

async function restoreStepSnapshot(db, stepId, snapshot, { keepFailed = true, errorMessage = null } = {}) {
  return updateStep(db, stepId, {
    rstep_canvas_state: snapshot.rstep_canvas_state,
    rstep_synthesis: snapshot.rstep_synthesis,
    rstep_calls: snapshot.rstep_calls,
    rstep_status: keepFailed ? 'failed' : snapshot.rstep_status,
    rstep_error_message: keepFailed ? errorMessage : snapshot.rstep_error_message,
    rstep_tool_calls_used: snapshot.rstep_tool_calls_used,
  });
}

async function rerunPrebuiltStep(db, serverId, bankId, step, snapshot) {
  const parameters = step.rstep_parameters || {};
  const dimensions = parameters.dimensions || [];
  const selections = step.rstep_selections || [];
  const entities = selections
    .filter((s) => s.kind === 'entity')
    .map((s) => (s.id ? String(s.id) : undefined))
    .filter(Boolean);

  if (!entities.length || !dimensions.length) {
    await updateStep(db, step.rstep_id, {
      rstep_status: 'failed',
      rstep_error_message: 'Prebuilt step is missing entities or dimensions',
      rstep_calls: [],
      rstep_tool_calls_used: 0,
    });
    return;
  }

  const prebuiltStart = Date.now();
  const result = await runPrebuiltResearch(db, serverId, bankId, { entities, dimensions });
  const prebuiltDuration = Date.now() - prebuiltStart;
  const prebuiltRequestBody = { server_id: serverId, bank_id: bankId, entities, dimensions };
  const prebuiltPayloadChars = JSON.stringify(prebuiltRequestBody).length;

  const buildPrebuiltCall = (status, extra = {}) => ({
    tool: 'prebuilt_research',
    mode: 'prebuilt',
    status,
    duration_ms: prebuiltDuration,
    request_payload_chars: prebuiltPayloadChars,
    request: {
      method: 'POST',
      url: '/research/prebuilt',
      body: prebuiltRequestBody,
    },
    ...extra,
  });

  if (!result.success) {
    logger.warn('Prebuilt re-run failed; restoring step snapshot', { stepId: step.rstep_id, error: result.error, code: result.code });
    await restoreStepSnapshot(db, step.rstep_id, snapshot, { errorMessage: result.error });
    return;
  }

  const mergedGraph = { nodes: [], edges: [] };
  const narratives = [];
  for (const dim of result.dimensions || []) {
    const found = (dim.entities || [])
      .filter((e) => e.found)
      .map((e) => e.entity);
    const modelNames = (dim.entities || [])
      .flatMap((e) => (e.model_results || []).filter((m) => m.found).map((m) => m.name))
      .filter((v, i, a) => a.indexOf(v) === i);
    const lines = [`## ${dim.dimension}`, ''];
    if (dim.result?.narrative) {
      lines.push(dim.result.narrative);
    } else {
      lines.push(`- Entities covered: ${found.join(', ') || 'none'}`);
      lines.push(`- Models applied: ${modelNames.join(', ') || 'none'}`);
    }
    narratives.push(lines.join('\n'));

    const jsonResult = dim.result?.json_result;
    if (jsonResult) {
      const graphs = Array.isArray(jsonResult) ? jsonResult : [jsonResult];
      for (const g of graphs) {
        if (!g || !Array.isArray(g.nodes)) continue;
        for (const n of g.nodes) {
          if (!mergedGraph.nodes.some((x) => x.id === n.id)) mergedGraph.nodes.push(n);
        }
        for (const e of g.edges || []) {
          const key = e.id || `${e.source}|${e.target}|${e.label}`;
          if (!mergedGraph.edges.some((x) => (x.id || `${x.source}|${x.target}|${x.label}`) === key)) {
            mergedGraph.edges.push(e);
          }
        }
      }
    }
  }

  const foundCount = (result.dimensions || []).reduce((sum, d) => sum + (d.found_count || 0), 0);
  const missingCount = (result.dimensions || []).reduce((sum, d) => sum + (d.missing_count || 0), 0);

  await updateStep(db, step.rstep_id, {
    rstep_canvas_state: { graph: mergedGraph },
    rstep_synthesis: { narrative: narratives.join('\n\n') },
    rstep_status: 'completed',
    rstep_error_message: null,
    rstep_tool_calls_used: 1,
    rstep_calls: [
      buildPrebuiltCall('success', {
        response_summary: {
          dimensions: (result.dimensions || []).map((d) => d.dimension),
          entity_count: entities.length,
          found_count: foundCount,
          missing_count: missingCount,
        },
      }),
    ],
  });
}

const toApiSession = (dbRow) => ({
  id: dbRow.rs_id,
  title: dbRow.rs_title,
  description: dbRow.rs_description,
  bank_id: dbRow.rs_bank_id,
  viewpoint_ids: dbRow.rs_viewpoint_ids,
  status: dbRow.rs_status,
  current_step_id: dbRow.rs_current_step_id,
  created_at: dbRow.rs_created_at,
  updated_at: dbRow.rs_updated_at,
});

const toApiStepSummary = (dbRow) => ({
  id: dbRow.rstep_id,
  session_id: dbRow.rs_id,
  parent_step_id: dbRow.rstep_parent_step_id,
  intent_text: dbRow.rstep_intent_text,
  action_type: dbRow.rstep_action_type,
  parameters: dbRow.rstep_parameters,
  created_at: dbRow.rstep_created_at,
  selections: dbRow.rstep_selections,
  viewpoint_ids: dbRow.rstep_viewpoint_ids,
  canvas: dbRow.rstep_canvas_state,
  synthesis: dbRow.rstep_synthesis,
  tool_calls_used: dbRow.rstep_tool_calls_used,
  calls: dbRow.rstep_calls,
  status: dbRow.rstep_status || 'completed',
  error_message: dbRow.rstep_error_message || null,
});

const toApiStep = (dbRow) => ({
  id: dbRow.rstep_id,
  session_id: dbRow.rs_id,
  parent_step_id: dbRow.rstep_parent_step_id,
  intent_text: dbRow.rstep_intent_text,
  action_type: dbRow.rstep_action_type,
  parameters: dbRow.rstep_parameters,
  selections: dbRow.rstep_selections,
  viewpoint_ids: dbRow.rstep_viewpoint_ids,
  canvas: dbRow.rstep_canvas_state,
  synthesis: dbRow.rstep_synthesis,
  tool_calls_used: dbRow.rstep_tool_calls_used,
  calls: dbRow.rstep_calls,
  status: dbRow.rstep_status || 'completed',
  error_message: dbRow.rstep_error_message || null,
  created_at: dbRow.rstep_created_at,
});

/**
 * @openapi
 * /research/discover:
 *   post:
 *     summary: Run one step of research discovery
 *     tags: [Research]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [bank_id, viewpoint_ids, intent_text]
 *             properties:
 *               server_id:
 *                 type: integer
 *               session_id:
 *                 type: integer
 *                 nullable: true
 *               bank_id:
 *                 type: string
 *               viewpoint_ids:
 *                 type: array
 *                 items: { type: integer }
 *               intent_text:
 *                 type: string
 *               query_depth:
 *                 type: string
 *                 enum: [prebuilt, recall, reflect, synthesize]
 *                 default: prebuilt
 *               selections:
 *                 type: array
 *               budget:
 *                 type: string
 *                 enum: [low, mid, high]
 *                 default: high
 *               max_tokens:
 *                 type: integer
 *                 nullable: true
 *               types:
 *                 type: array
 *                 items: { type: string }
 *                 nullable: true
 *               prefer_observations:
 *                 type: boolean
 *                 nullable: true
 *               include:
 *                 type: object
 *                 nullable: true
 *               tags:
 *                 type: array
 *                 items: { type: string }
 *                 nullable: true
 *               tags_match:
 *                 type: string
 *                 nullable: true
 *     responses:
 *       200:
 *         description: Discovery step result
 *       400:
 *         description: Invalid input
 *       500:
 *         description: Agent error
 */
router.post('/discover', async (req, res) => {
  const start = Date.now();

  try {
    const {
      server_id,
      session_id,
      bank_id,
      viewpoint_ids,
      intent_text,
      query_depth,
      selections,
      budget,
      max_tokens,
      types,
      prefer_observations,
      include,
      fact_types,
      exclude_mental_models,
      tags,
      tags_match,
    } = req.body;

    if (!bank_id || typeof bank_id !== 'string') {
      sendResponse({ res, status: 400, error: 'bank_id is required', code: 'VALIDATION_ERROR', logger, method: 'POST', path: '/research/discover', duration: Date.now() - start });
      return;
    }
    if (!intent_text || typeof intent_text !== 'string') {
      sendResponse({ res, status: 400, error: 'intent_text is required', code: 'VALIDATION_ERROR', logger, method: 'POST', path: '/research/discover', duration: Date.now() - start });
      return;
    }
    if (!Array.isArray(viewpoint_ids)) {
      sendResponse({ res, status: 400, error: 'viewpoint_ids must be an array', code: 'VALIDATION_ERROR', logger, method: 'POST', path: '/research/discover', duration: Date.now() - start });
      return;
    }
    if (!server_id) {
      sendResponse({ res, status: 400, error: 'server_id is required', code: 'VALIDATION_ERROR', logger, method: 'POST', path: '/research/discover', duration: Date.now() - start });
      return;
    }

    const effectiveDepth = isValidQueryDepth(query_depth) ? query_depth : 'prebuilt';

    const handlerOptions = {
      budget: ['low', 'mid', 'high'].includes(budget) ? budget : 'high',
      ...(max_tokens !== undefined && { max_tokens }),
      ...(types !== undefined && { types }),
      ...(prefer_observations !== undefined && { prefer_observations }),
      ...(include !== undefined && { include }),
      ...(fact_types !== undefined && { fact_types }),
      ...(exclude_mental_models !== undefined && { exclude_mental_models }),
      ...(tags !== undefined && { tags }),
      ...(tags_match !== undefined && { tags_match }),
    };

    // Get or create session.
    let rsId = session_id;
    let parentStepId = null;
    if (!rsId) {
      const sessionResult = await createSession(db, {
        rs_title: intent_text.slice(0, 120),
        rs_description: null,
        rs_bank_id: bank_id,
        rs_viewpoint_ids: viewpoint_ids,
        rs_status: 'active',
        rs_current_step_id: null,
      });
      if (!sessionResult.success) {
        sendResponse({ res, status: 500, error: sessionResult.error, code: sessionResult.code || 'DATABASE_ERROR', logger, method: 'POST', path: '/research/discover', duration: Date.now() - start });
        return;
      }
      rsId = sessionResult.data;
    } else {
      const sessionResult = await getSessionWithCurrentStep(db, rsId);
      if (!sessionResult.success || !sessionResult.data) {
        sendResponse({ res, status: 404, error: 'Research session not found', code: 'NOT_FOUND', logger, method: 'POST', path: '/research/discover', duration: Date.now() - start });
        return;
      }
      parentStepId = sessionResult.data.current_step?.rstep_id || null;
    }

    // Create a running step immediately so the UI can poll for completion.
    const stepResult = createStep(db, {
      rs_id: rsId,
      rstep_parent_step_id: parentStepId,
      rstep_intent_text: intent_text,
      rstep_selections: selections || [],
      rstep_action_type: effectiveDepth,
      rstep_parameters: handlerOptions,
      rstep_viewpoint_ids: viewpoint_ids,
      rstep_canvas_state: {},
      rstep_synthesis: {},
      rstep_tool_calls_used: 0,
      rstep_status: 'running',
      rstep_error_message: null,
      rstep_calls: [],
    });

    if (!stepResult.success) {
      sendResponse({ res, status: 500, error: stepResult.error, code: stepResult.code || 'DATABASE_ERROR', logger, method: 'POST', path: '/research/discover', duration: Date.now() - start });
      return;
    }

    const stepId = stepResult.data;

    // Update session current step.
    const updateSessionResult = updateSessionCurrentStep(db, rsId, stepId);
    if (!updateSessionResult.success) {
      sendResponse({ res, status: 500, error: updateSessionResult.error, code: updateSessionResult.code || 'DATABASE_ERROR', logger, method: 'POST', path: '/research/discover', duration: Date.now() - start });
      return;
    }

    // Run the agent outside the request lifecycle. The agent updates the step
    // row when it completes, and Hindsight operations are tracked in
    // pending_operations for the top-bar indicator.
    setImmediate(() => {
      runDiscoverStep({
        db,
        serverId: server_id,
        bankId: bank_id,
        queryDepth: effectiveDepth,
        intentText: intent_text,
        selections: selections || [],
        options: handlerOptions,
        rsId,
        rstepId: stepId,
      }).catch((agentErr) => {
        logger.error('Discover agent runner failed outside request', { error: agentErr.message, stack: agentErr.stack, rsId, stepId });
      });
    });

    sendResponse({
      res,
      status: 202,
      data: {
        step_id: stepId,
        session_id: rsId,
        status: 'running',
        bank_id: bank_id,
        viewpoint_ids: viewpoint_ids,
        query_depth: effectiveDepth,
      },
      logger,
      method: 'POST',
      path: '/research/discover',
      duration: Date.now() - start,
    });
  } catch (err) {
    logger.error('Research discover route error', { error: err.message, stack: err.stack });
    sendResponse({ res, status: 500, error: err.message, code: 'UNKNOWN_ERROR', logger, method: 'POST', path: '/research/discover', duration: Date.now() - start });
  }
});

/**
 * @openapi
 * /research/eligible-mental-models:
 *   post:
 *     summary: List eligible derived mental models without querying Hindsight
 *     tags: [Research]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [entities, dimensions]
 *             properties:
 *               entities: { type: array, items: { type: string } }
 *               dimensions: { type: array, items: { type: string } }
 *     responses:
 *       200:
 *         description: Per-dimension derived candidate list
 *       400:
 *         description: Invalid input
 *       500:
 *         description: Database error
 */
router.post('/eligible-mental-models', async (req, res) => {
  const start = Date.now();
  try {
    const { entities, dimensions } = req.body;

    if (!Array.isArray(entities) || entities.length === 0) {
      sendResponse({ res, status: 400, error: 'entities must be a non-empty array', code: 'VALIDATION_ERROR', logger, method: 'POST', path: '/research/eligible-mental-models', duration: Date.now() - start });
      return;
    }
    if (!Array.isArray(dimensions) || dimensions.length === 0) {
      sendResponse({ res, status: 400, error: 'dimensions must be a non-empty array', code: 'VALIDATION_ERROR', logger, method: 'POST', path: '/research/eligible-mental-models', duration: Date.now() - start });
      return;
    }

    const result = await listEligibleMentalModels(db, { entities, dimensions });
    if (!result.success) {
      sendResponse({ res, status: mapErrorToStatus(result.code), error: result.error, code: result.code, logger, method: 'POST', path: '/research/eligible-mental-models', duration: Date.now() - start });
      return;
    }

    sendResponse({ res, status: 200, data: result, logger, method: 'POST', path: '/research/eligible-mental-models', duration: Date.now() - start });
  } catch (err) {
    logger.error('Research eligible-mental-models route error', { error: err.message, stack: err.stack });
    sendResponse({ res, status: 500, error: err.message, code: 'UNKNOWN_ERROR', logger, method: 'POST', path: '/research/eligible-mental-models', duration: Date.now() - start });
  }
});

/**
 * @openapi
 * /research/prebuilt:
 *   post:
 *     summary: Run prebuilt research (query_depth=prebuilt)
 *     tags: [Research]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [server_id, bank_id, entities, dimensions]
 *             properties:
 *               server_id: { type: integer }
 *               bank_id: { type: string }
 *               entities: { type: array, items: { type: string } }
 *               dimensions: { type: array, items: { type: string } }
 *     responses:
 *       200:
 *         description: Per-dimension entity results with merged narrative/graph output
 *       400:
 *         description: Invalid input
 *       500:
 *         description: Prebuilt research error
 */
router.post('/prebuilt', async (req, res) => {
  const start = Date.now();
  try {
    const { server_id, bank_id, entities, dimensions, session_id } = req.body;

    if (!server_id || typeof server_id !== 'number') {
      sendResponse({ res, status: 400, error: 'server_id is required', code: 'VALIDATION_ERROR', logger, method: 'POST', path: '/research/prebuilt', duration: Date.now() - start });
      return;
    }
    if (!bank_id || typeof bank_id !== 'string') {
      sendResponse({ res, status: 400, error: 'bank_id is required', code: 'VALIDATION_ERROR', logger, method: 'POST', path: '/research/prebuilt', duration: Date.now() - start });
      return;
    }
    if (!Array.isArray(entities) || entities.length === 0) {
      sendResponse({ res, status: 400, error: 'entities must be a non-empty array', code: 'VALIDATION_ERROR', logger, method: 'POST', path: '/research/prebuilt', duration: Date.now() - start });
      return;
    }
    if (!Array.isArray(dimensions) || dimensions.length === 0) {
      sendResponse({ res, status: 400, error: 'dimensions must be a non-empty array', code: 'VALIDATION_ERROR', logger, method: 'POST', path: '/research/prebuilt', duration: Date.now() - start });
      return;
    }

    // Get or create session so prebuilt queries are tracked in the trail.
    let rsId = session_id;
    let parentStepId = null;
    const intentText = entities.join(', ');
    if (!rsId) {
      const sessionResult = await createSession(db, {
        rs_title: intentText.slice(0, 120),
        rs_description: null,
        rs_bank_id: bank_id,
        rs_viewpoint_ids: [],
        rs_status: 'active',
        rs_current_step_id: null,
      });
      if (!sessionResult.success) {
        sendResponse({ res, status: 500, error: sessionResult.error, code: sessionResult.code || 'DATABASE_ERROR', logger, method: 'POST', path: '/research/prebuilt', duration: Date.now() - start });
        return;
      }
      rsId = sessionResult.data;
    } else {
      const sessionResult = await getSessionWithCurrentStep(db, rsId);
      if (!sessionResult.success || !sessionResult.data) {
        sendResponse({ res, status: 404, error: 'Research session not found', code: 'NOT_FOUND', logger, method: 'POST', path: '/research/prebuilt', duration: Date.now() - start });
        return;
      }
      parentStepId = sessionResult.data.current_step?.rstep_id || null;
    }

    const stepResult = await createStep(db, {
      rs_id: rsId,
      rstep_parent_step_id: parentStepId,
      rstep_intent_text: intentText,
      rstep_selections: entities.map((id) => ({ id, kind: 'entity' })),
      rstep_action_type: 'prebuilt',
      rstep_parameters: { dimensions },
      rstep_viewpoint_ids: [],
      rstep_canvas_state: {},
      rstep_synthesis: {},
      rstep_tool_calls_used: 0,
      rstep_status: 'running',
      rstep_error_message: null,
      rstep_calls: [],
    });

    if (!stepResult.success) {
      sendResponse({ res, status: 500, error: stepResult.error, code: stepResult.code || 'DATABASE_ERROR', logger, method: 'POST', path: '/research/prebuilt', duration: Date.now() - start });
      return;
    }

    const stepId = stepResult.data;

    const updateSessionResult = await updateSessionCurrentStep(db, rsId, stepId);
    if (!updateSessionResult.success) {
      sendResponse({ res, status: 500, error: updateSessionResult.error, code: updateSessionResult.code || 'DATABASE_ERROR', logger, method: 'POST', path: '/research/prebuilt', duration: Date.now() - start });
      return;
    }

    const prebuiltStart = Date.now();
    const result = await runPrebuiltResearch(db, server_id, bank_id, { entities, dimensions });
    const prebuiltDuration = Date.now() - prebuiltStart;
    const prebuiltRequestBody = { server_id, bank_id, entities, dimensions, session_id: rsId };
    const prebuiltPayloadChars = JSON.stringify(prebuiltRequestBody).length;

    const buildPrebuiltCall = (status, extra = {}) => ({
      tool: 'prebuilt_research',
      mode: 'prebuilt',
      status,
      duration_ms: prebuiltDuration,
      request_payload_chars: prebuiltPayloadChars,
      request: {
        method: 'POST',
        url: '/research/prebuilt',
        body: prebuiltRequestBody,
      },
      ...extra,
    });

    if (!result.success) {
      await updateStep(db, stepId, {
        rstep_status: 'failed',
        rstep_error_message: result.error || 'Prebuilt research failed',
        rstep_tool_calls_used: 1,
        rstep_calls: [buildPrebuiltCall('failure', { error: result.error, code: result.code })],
      });
      sendResponse({ res, status: mapErrorToStatus(result.code), error: result.error, code: result.code, logger, method: 'POST', path: '/research/prebuilt', duration: Date.now() - start });
      return;
    }

    // Derive a merged canvas/synthesis for the step so it works in the trail.
    const mergedGraph = { nodes: [], edges: [] };
    const narratives = [];
    for (const dim of result.dimensions || []) {
      const found = (dim.entities || [])
        .filter((e) => e.found)
        .map((e) => e.entity);
      const modelNames = (dim.entities || [])
        .flatMap((e) => (e.model_results || []).filter((m) => m.found).map((m) => m.name))
        .filter((v, i, a) => a.indexOf(v) === i);
      const lines = [`## ${dim.dimension}`, ''];
      if (dim.result?.narrative) {
        lines.push(dim.result.narrative);
      } else {
        lines.push(`- Entities covered: ${found.join(', ') || 'none'}`);
        lines.push(`- Models applied: ${modelNames.join(', ') || 'none'}`);
      }
      narratives.push(lines.join('\n'));

      const jsonResult = dim.result?.json_result;
      if (jsonResult) {
        const graphs = Array.isArray(jsonResult) ? jsonResult : [jsonResult];
        for (const g of graphs) {
          if (!g || !Array.isArray(g.nodes)) continue;
          for (const n of g.nodes) {
            if (!mergedGraph.nodes.some((x) => x.id === n.id)) mergedGraph.nodes.push(n);
          }
          for (const e of g.edges || []) {
            const key = e.id || `${e.source}|${e.target}|${e.label}`;
            if (!mergedGraph.edges.some((x) => (x.id || `${x.source}|${x.target}|${x.label}`) === key)) {
              mergedGraph.edges.push(e);
            }
          }
        }
      }
    }

    const foundCount = (result.dimensions || []).reduce((sum, d) => sum + (d.found_count || 0), 0);
    const missingCount = (result.dimensions || []).reduce((sum, d) => sum + (d.missing_count || 0), 0);

    await updateStep(db, stepId, {
      rstep_canvas_state: { graph: mergedGraph },
      rstep_synthesis: { narrative: narratives.join('\n\n') },
      rstep_status: 'completed',
      rstep_error_message: null,
      rstep_tool_calls_used: 1,
      rstep_calls: [
        buildPrebuiltCall('success', {
          response_summary: {
            dimensions: (result.dimensions || []).map((d) => d.dimension),
            entity_count: entities.length,
            found_count: foundCount,
            missing_count: missingCount,
          },
        }),
      ],
    });

    sendResponse({
      res,
      status: 200,
      data: { ...result, session_id: rsId, step_id: stepId },
      logger,
      method: 'POST',
      path: '/research/prebuilt',
      duration: Date.now() - start,
    });
  } catch (err) {
    logger.error('Research prebuilt route error', { error: err.message, stack: err.stack });
    sendResponse({ res, status: 500, error: err.message, code: 'UNKNOWN_ERROR', logger, method: 'POST', path: '/research/prebuilt', duration: Date.now() - start });
  }
});

/**
 * @openapi
 * /research/mental-models:
 *   post:
 *     summary: Discover mental models for entities across dimensions
 *     tags: [Research]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [server_id, bank_id, entities, dimensions]
 *             properties:
 *               server_id: { type: integer }
 *               bank_id: { type: string }
 *               entities: { type: array, items: { type: string } }
 *               dimensions: { type: array, items: { type: string } }
 *     responses:
 *       200:
 *         description: Per-dimension candidate list with found/missing status
 *       400:
 *         description: Invalid input
 *       500:
 *         description: Discovery error
 */
router.post('/mental-models', async (req, res) => {
  const start = Date.now();
  try {
    const { server_id, bank_id, entities, dimensions } = req.body;

    if (!server_id || typeof server_id !== 'number') {
      sendResponse({ res, status: 400, error: 'server_id is required', code: 'VALIDATION_ERROR', logger, method: 'POST', path: '/research/mental-models', duration: Date.now() - start });
      return;
    }
    if (!bank_id || typeof bank_id !== 'string') {
      sendResponse({ res, status: 400, error: 'bank_id is required', code: 'VALIDATION_ERROR', logger, method: 'POST', path: '/research/mental-models', duration: Date.now() - start });
      return;
    }
    if (!Array.isArray(entities) || entities.length === 0) {
      sendResponse({ res, status: 400, error: 'entities must be a non-empty array', code: 'VALIDATION_ERROR', logger, method: 'POST', path: '/research/mental-models', duration: Date.now() - start });
      return;
    }
    if (!Array.isArray(dimensions) || dimensions.length === 0) {
      sendResponse({ res, status: 400, error: 'dimensions must be a non-empty array', code: 'VALIDATION_ERROR', logger, method: 'POST', path: '/research/mental-models', duration: Date.now() - start });
      return;
    }

    const result = await discoverMentalModelsByDimensions(db, server_id, bank_id, { entities, dimensions });
    if (!result.success) {
      sendResponse({ res, status: mapErrorToStatus(result.code), error: result.error, code: result.code, logger, method: 'POST', path: '/research/mental-models', duration: Date.now() - start });
      return;
    }

    sendResponse({ res, status: 200, data: result, logger, method: 'POST', path: '/research/mental-models', duration: Date.now() - start });
  } catch (err) {
    logger.error('Research mental-models route error', { error: err.message, stack: err.stack });
    sendResponse({ res, status: 500, error: err.message, code: 'UNKNOWN_ERROR', logger, method: 'POST', path: '/research/mental-models', duration: Date.now() - start });
  }
});

/**
 * @openapi
 * /research/sessions/{id}:
 *   get:
 *     summary: Get a research session
 *     tags: [Research]
 */
router.get('/sessions/:id', async (req, res) => {
  const start = Date.now();
  const idCheck = validateId({ req, res, paramName: 'id', logger, path: '/research/sessions/:id', start });
  if (!idCheck.valid) return;

  const result = await getSessionWithCurrentStep(db, idCheck.id);
  if (!result.success || !result.data) {
    sendResponse({ res, status: 404, error: 'Research session not found', code: 'NOT_FOUND', logger, method: 'GET', path: '/research/sessions/:id', duration: Date.now() - start });
    return;
  }
  sendResponse({ res, status: 200, data: toApiSession(result.data), logger, method: 'GET', path: '/research/sessions/:id', duration: Date.now() - start });
});

/**
 * @openapi
 * /research/sessions:
 *   post:
 *     summary: Create a new research session
 *     tags: [Research]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [bank_id, viewpoint_ids]
 *             properties:
 *               title:
 *                 type: string
 *               description:
 *                 type: string
 *               bank_id:
 *                 type: string
 *               viewpoint_ids:
 *                 type: array
 *                 items: { type: integer }
 */
router.post('/synthesize', async (req, res) => {
  const start = Date.now();

  try {
    const {
      server_id,
      bank_id,
      session_id,
      source_step_ids,
      intent_text,
      budget,
      max_tokens,
    } = req.body;

    if (!bank_id || typeof bank_id !== 'string') {
      sendResponse({ res, status: 400, error: 'bank_id is required', code: 'VALIDATION_ERROR', logger, method: 'POST', path: '/research/synthesize', duration: Date.now() - start });
      return;
    }
    if (!intent_text || typeof intent_text !== 'string') {
      sendResponse({ res, status: 400, error: 'intent_text is required', code: 'VALIDATION_ERROR', logger, method: 'POST', path: '/research/synthesize', duration: Date.now() - start });
      return;
    }
    if (!server_id || typeof server_id !== 'number') {
      sendResponse({ res, status: 400, error: 'server_id is required', code: 'VALIDATION_ERROR', logger, method: 'POST', path: '/research/synthesize', duration: Date.now() - start });
      return;
    }
    if (!session_id || typeof session_id !== 'number') {
      sendResponse({ res, status: 400, error: 'session_id is required', code: 'VALIDATION_ERROR', logger, method: 'POST', path: '/research/synthesize', duration: Date.now() - start });
      return;
    }
    if (!Array.isArray(source_step_ids) || source_step_ids.length === 0) {
      sendResponse({ res, status: 400, error: 'source_step_ids must be a non-empty array', code: 'VALIDATION_ERROR', logger, method: 'POST', path: '/research/synthesize', duration: Date.now() - start });
      return;
    }

    const sessionResult = await getSessionWithCurrentStep(db, session_id);
    if (!sessionResult.success || !sessionResult.data) {
      sendResponse({ res, status: 404, error: 'Research session not found', code: 'NOT_FOUND', logger, method: 'POST', path: '/research/synthesize', duration: Date.now() - start });
      return;
    }

    if (sessionResult.data.rs_bank_id !== bank_id) {
      sendResponse({ res, status: 400, error: 'session does not belong to the provided bank_id', code: 'BANK_MISMATCH', logger, method: 'POST', path: '/research/synthesize', duration: Date.now() - start });
      return;
    }

    logger.info('Synthesize request payload', { source_step_ids, count: source_step_ids.length });

    const allStepsResult = await listStepsForSession(db, session_id);
    if (!allStepsResult.success) {
      sendResponse({ res, status: 500, error: allStepsResult.error, code: allStepsResult.code || 'DATABASE_ERROR', logger, method: 'POST', path: '/research/synthesize', duration: Date.now() - start });
      return;
    }

    const stepIdsInDb = (allStepsResult.data || []).map((s) => s.rstep_id);
    logger.info('Session steps loaded', { sessionId: session_id, dbStepCount: allStepsResult.data?.length, stepIdsInDb });

    const stepMap = new Map((allStepsResult.data || []).map((s) => [s.rstep_id, s]));
    const sourceSteps = [];
    for (const rawId of source_step_ids) {
      const id = typeof rawId === 'number' ? rawId : Number(rawId);
      if (!Number.isFinite(id)) {
        sendResponse({ res, status: 400, error: `Invalid source_step_id: ${rawId}`, code: 'SOURCE_STEP_INVALID', logger, method: 'POST', path: '/research/synthesize', duration: Date.now() - start });
        return;
      }
      const step = stepMap.get(id);
      if (!step) {
        sendResponse({ res, status: 400, error: `Source step ${id} not found in session`, code: 'SOURCE_STEP_NOT_FOUND', logger, method: 'POST', path: '/research/synthesize', duration: Date.now() - start });
        return;
      }
      sourceSteps.push(step);
    }

    const handlerOptions = {
      budget: ['low', 'mid', 'high'].includes(budget) ? budget : 'high',
      ...(max_tokens !== undefined && { max_tokens }),
      source_steps: sourceSteps.map((s) => ({
        intent_text: s.rstep_intent_text,
        action_type: s.rstep_action_type,
        parameters: s.rstep_parameters,
        selections: s.rstep_selections,
        viewpoint_ids: s.rstep_viewpoint_ids,
        canvas: s.rstep_canvas_state,
        synthesis: s.rstep_synthesis,
        calls: s.rstep_calls,
      })),
    };

    const parentStepId = sessionResult.data.current_step?.rstep_id || null;

    const stepResult = await createStep(db, {
      rs_id: session_id,
      rstep_parent_step_id: parentStepId,
      rstep_intent_text: intent_text,
      rstep_selections: source_step_ids.map((id) => ({ id, kind: 'step' })),
      rstep_action_type: 'synthesize',
      rstep_parameters: handlerOptions,
      rstep_viewpoint_ids: [],
      rstep_canvas_state: {},
      rstep_synthesis: {},
      rstep_tool_calls_used: 0,
      rstep_status: 'running',
      rstep_error_message: null,
      rstep_calls: [],
    });

    if (!stepResult.success) {
      sendResponse({ res, status: 500, error: stepResult.error, code: stepResult.code || 'DATABASE_ERROR', logger, method: 'POST', path: '/research/synthesize', duration: Date.now() - start });
      return;
    }

    const stepId = stepResult.data;

    const updateSessionResult = await updateSessionCurrentStep(db, session_id, stepId);
    if (!updateSessionResult.success) {
      sendResponse({ res, status: 500, error: updateSessionResult.error, code: updateSessionResult.code || 'DATABASE_ERROR', logger, method: 'POST', path: '/research/synthesize', duration: Date.now() - start });
      return;
    }

    setImmediate(() => {
      runDiscoverStep({
        db,
        serverId: server_id,
        bankId: bank_id,
        queryDepth: 'synthesize',
        intentText: intent_text,
        selections: source_step_ids.map((id) => ({ id, kind: 'step' })),
        options: handlerOptions,
        rsId: session_id,
        rstepId: stepId,
      }).catch((agentErr) => {
        logger.error('Synthesize agent runner failed outside request', { error: agentErr.message, stack: agentErr.stack, session_id, stepId });
      });
    });

    sendResponse({
      res,
      status: 202,
      data: {
        step_id: stepId,
        session_id: session_id,
        status: 'running',
        bank_id: bank_id,
        viewpoint_ids: [],
        query_depth: 'synthesize',
        action_type: 'synthesize',
        parameters: handlerOptions,
      },
      logger,
      method: 'POST',
      path: '/research/synthesize',
      duration: Date.now() - start,
    });
  } catch (err) {
    logger.error('Research synthesize route error', { error: err.message, stack: err.stack });
    sendResponse({ res, status: 500, error: err.message, code: 'UNKNOWN_ERROR', logger, method: 'POST', path: '/research/synthesize', duration: Date.now() - start });
  }
});

/**
 * @openapi
 * /research/sessions:
 *   post:
 *     summary: Create a new research session
 *     tags: [Research]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [bank_id, viewpoint_ids]
 *             properties:
 *               title:
 *                 type: string
 *               description:
 *                 type: string
 *               bank_id:
 *                 type: string
 *               viewpoint_ids:
 *                 type: array
 *                 items: { type: integer }
 */
router.post('/sessions', async (req, res) => {
  const start = Date.now();
  const { title, description, bank_id, viewpoint_ids } = req.body;

  if (!bank_id || typeof bank_id !== 'string') {
    sendResponse({ res, status: 400, error: 'bank_id is required', code: 'VALIDATION_ERROR', logger, method: 'POST', path: '/research/sessions', duration: Date.now() - start });
    return;
  }
  if (!Array.isArray(viewpoint_ids)) {
    sendResponse({ res, status: 400, error: 'viewpoint_ids must be an array', code: 'VALIDATION_ERROR', logger, method: 'POST', path: '/research/sessions', duration: Date.now() - start });
    return;
  }

  const result = await createSession(db, {
    rs_title: typeof title === 'string' && title.trim() ? title.trim() : 'Untitled session',
    rs_description: typeof description === 'string' && description.trim() ? description.trim() : null,
    rs_bank_id: bank_id,
    rs_viewpoint_ids: viewpoint_ids,
    rs_status: 'active',
  });

  if (!result.success) {
    sendResponse({ res, status: mapErrorToStatus(result.code) || 500, error: result.error, code: result.code || 'DATABASE_ERROR', logger, method: 'POST', path: '/research/sessions', duration: Date.now() - start });
    return;
  }
  sendResponse({ res, status: 201, data: { session_id: result.data }, logger, method: 'POST', path: '/research/sessions', duration: Date.now() - start });
});

/**
 * @openapi
 * /research/banks/{bankId}/sessions:
 *   get:
 *     summary: List research sessions for a bank
 *     tags: [Research]
 */
router.get('/banks/:bankId/sessions', async (req, res) => {
  const start = Date.now();
  const bankId = req.params.bankId;
  if (!bankId || typeof bankId !== 'string') {
    sendResponse({ res, status: 400, error: 'bankId is required', code: 'VALIDATION_ERROR', logger, method: 'GET', path: '/research/banks/:bankId/sessions', duration: Date.now() - start });
    return;
  }

  const result = await listSessionsByBank(db, bankId);
  if (!result.success) {
    sendResponse({ res, status: 500, error: result.error, code: result.code || 'DATABASE_ERROR', logger, method: 'GET', path: '/research/banks/:bankId/sessions', duration: Date.now() - start });
    return;
  }
  sendResponse({ res, status: 200, data: (result.data || []).map(toApiSession), logger, method: 'GET', path: '/research/banks/:bankId/sessions', duration: Date.now() - start });
});

/**
 * @openapi
 * /research/sessions/{id}:
 *   put:
 *     summary: Update a research session (rename, status, etc.)
 *     tags: [Research]
 *   delete:
 *     summary: Delete a research session and its steps
 *     tags: [Research]
 */
router.put('/sessions/:id', async (req, res) => {
  const start = Date.now();
  const idCheck = validateId({ req, res, paramName: 'id', logger, path: '/research/sessions/:id', start });
  if (!idCheck.valid) return;

  const { title, description, status } = req.body;
  const updateData = {};
  if (title !== undefined) updateData.rs_title = title;
  if (description !== undefined) updateData.rs_description = description;
  if (status !== undefined) updateData.rs_status = status;

  const result = await updateSession(db, idCheck.id, updateData);
  if (!result.success) {
    sendResponse({ res, status: mapErrorToStatus(result.code) || 500, error: result.error, code: result.code || 'DATABASE_ERROR', logger, method: 'PUT', path: '/research/sessions/:id', duration: Date.now() - start });
    return;
  }
  sendResponse({ res, status: 200, data: { updated: true, session_id: idCheck.id }, logger, method: 'PUT', path: '/research/sessions/:id', duration: Date.now() - start });
});

router.delete('/sessions/:id', async (req, res) => {
  const start = Date.now();
  const idCheck = validateId({ req, res, paramName: 'id', logger, path: '/research/sessions/:id', start });
  if (!idCheck.valid) return;

  const result = await deleteSessionWithSteps(db, idCheck.id);
  if (!result.success) {
    sendResponse({ res, status: mapErrorToStatus(result.code) || 500, error: result.error, code: result.code || 'DATABASE_ERROR', logger, method: 'DELETE', path: '/research/sessions/:id', duration: Date.now() - start });
    return;
  }
  sendResponse({ res, status: 200, data: { deleted: true, session_id: idCheck.id }, logger, method: 'DELETE', path: '/research/sessions/:id', duration: Date.now() - start });
});

/**
 * @openapi
 * /research/sessions/{id}/steps:
 *   get:
 *     summary: List steps for a research session
 *     tags: [Research]
 */
router.get('/sessions/:id/steps', async (req, res) => {
  const start = Date.now();
  const idCheck = validateId({ req, res, paramName: 'id', logger, path: '/research/sessions/:id/steps', start });
  if (!idCheck.valid) return;

  const result = await listStepsForSession(db, idCheck.id);
  if (!result.success) {
    sendResponse({ res, status: 500, error: result.error, code: result.code || 'DATABASE_ERROR', logger, method: 'GET', path: '/research/sessions/:id/steps', duration: Date.now() - start });
    return;
  }
  sendResponse({ res, status: 200, data: (result.data || []).map(toApiStepSummary), logger, method: 'GET', path: '/research/sessions/:id/steps', duration: Date.now() - start });
});

/**
 * @openapi
 * /research/steps/{id}:
 *   get:
 *     summary: Get a single research step
 *     tags: [Research]
 *   delete:
 *     summary: Delete a research step and its dependent descendants
 *     tags: [Research]
 *     description: |
 *       Removes a query from its research session. The step's contribution to the
 *       merged entity node set is removed automatically because the merge is
 *       derived on-demand from the remaining steps. Dependent child steps are
 *       removed via cascading foreign key.
 *     responses:
 *       200:
 *         description: Step deleted successfully
 *       404:
 *         description: Research step not found
 *       500:
 *         description: Database error
 */
router.get('/steps/:id', async (req, res) => {
  const start = Date.now();
  const idCheck = validateId({ req, res, paramName: 'id', logger, path: '/research/steps/:id', start });
  if (!idCheck.valid) return;

  const result = await getStep(db, idCheck.id);
  if (!result.success || !result.data) {
    sendResponse({ res, status: 404, error: 'Research step not found', code: 'NOT_FOUND', logger, method: 'GET', path: '/research/steps/:id', duration: Date.now() - start });
    return;
  }
  sendResponse({ res, status: 200, data: toApiStep(result.data), logger, method: 'GET', path: '/research/steps/:id', duration: Date.now() - start });
});

router.delete('/steps/:id', async (req, res) => {
  const start = Date.now();
  const idCheck = validateId({ req, res, paramName: 'id', logger, path: '/research/steps/:id', start });
  if (!idCheck.valid) return;

  const result = await deleteStepWithSession(db, idCheck.id);

  if (result.success && result.data) {
    sendResponse({
      res,
      status: 200,
      data: {
        deleted_step_id: idCheck.id,
        session_id: result.data.session_id,
        remaining_step_count: result.data.remaining_step_count,
      },
      logger,
      method: 'DELETE',
      path: '/research/steps/:id',
      duration: Date.now() - start,
    });
    return;
  }

  if (result.success && !result.data) {
    sendResponse({ res, status: 404, error: 'Research step not found', code: 'NOT_FOUND', logger, method: 'DELETE', path: '/research/steps/:id', duration: Date.now() - start });
    return;
  }

  sendResponse({
    res,
    status: mapErrorToStatus(result.code),
    error: result.error,
    code: result.code || 'UNKNOWN_ERROR',
    logger,
    method: 'DELETE',
    path: '/research/steps/:id',
    duration: Date.now() - start,
  });
});

/**
 * @openapi
 * /research/steps/{id}/rerun:
 *   post:
 *     summary: Re-run an existing research step in place
 *     tags: [Research]
 *     description: |
 *       Re-executes the original query using the same runner that created the
 *       step. On success the step's canvas/synthesis/calls/status are replaced
 *       with the new result. On failure the previous step state is restored so
 *       the step remains non-destructive.
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [server_id]
 *             properties:
 *               server_id:
 *                 type: integer
 *     responses:
 *       202:
 *         description: Re-run started; poll the step for completion
 *       404:
 *         description: Step not found
 *       400:
 *         description: Invalid server_id or unsupported action_type
 */
router.post('/steps/:id/rerun', async (req, res) => {
  const start = Date.now();
  const idCheck = validateId({ req, res, paramName: 'id', logger, path: '/research/steps/:id/rerun', start });
  if (!idCheck.valid) return;

  const { server_id } = req.body;
  if (!server_id || typeof server_id !== 'number') {
    sendResponse({ res, status: 400, error: 'server_id is required', code: 'VALIDATION_ERROR', logger, method: 'POST', path: '/research/steps/:id/rerun', duration: Date.now() - start });
    return;
  }

  const stepResult = await getStep(db, idCheck.id);
  if (!stepResult.success || !stepResult.data) {
    sendResponse({ res, status: 404, error: 'Research step not found', code: 'NOT_FOUND', logger, method: 'POST', path: '/research/steps/:id/rerun', duration: Date.now() - start });
    return;
  }

  const step = stepResult.data;
  const sessionResult = await getSession(db, step.rs_id);
  if (!sessionResult.success || !sessionResult.data) {
    sendResponse({ res, status: 404, error: 'Research session not found', code: 'NOT_FOUND', logger, method: 'POST', path: '/research/steps/:id/rerun', duration: Date.now() - start });
    return;
  }
  const bankId = sessionResult.data.rs_bank_id;
  if (!bankId) {
    sendResponse({ res, status: 500, error: 'Session is missing bank_id', code: 'DATABASE_ERROR', logger, method: 'POST', path: '/research/steps/:id/rerun', duration: Date.now() - start });
    return;
  }

  const supportedActionTypes = new Set(['prebuilt', 'recall', 'reflect', 'synthesize']);
  if (!supportedActionTypes.has(step.rstep_action_type)) {
    sendResponse({ res, status: 400, error: `Re-run not supported for action_type: ${step.rstep_action_type}`, code: 'VALIDATION_ERROR', logger, method: 'POST', path: '/research/steps/:id/rerun', duration: Date.now() - start });
    return;
  }

  const snapshot = {
    rstep_canvas_state: step.rstep_canvas_state,
    rstep_synthesis: step.rstep_synthesis,
    rstep_calls: step.rstep_calls,
    rstep_status: step.rstep_status,
    rstep_error_message: step.rstep_error_message,
    rstep_tool_calls_used: step.rstep_tool_calls_used,
  };

  // Mark step as running and clear previous error so the UI reflects the re-run.
  const runningUpdate = await updateStep(db, idCheck.id, {
    rstep_status: 'running',
    rstep_error_message: null,
    rstep_created_at: new Date().toISOString(),
  });
  if (!runningUpdate.success) {
    sendResponse({ res, status: 500, error: runningUpdate.error, code: runningUpdate.code || 'DATABASE_ERROR', logger, method: 'POST', path: '/research/steps/:id/rerun', duration: Date.now() - start });
    return;
  }

  setImmediate(() => {
    if (step.rstep_action_type === 'prebuilt') {
      rerunPrebuiltStep(db, server_id, bankId, step, snapshot).catch((err) => {
        logger.error('Prebuilt re-run runner error; restoring step snapshot', { stepId: step.rstep_id, error: err.message });
        restoreStepSnapshot(db, step.rstep_id, snapshot, { errorMessage: err.message }).catch((restoreErr) => {
          logger.error('Failed to restore step snapshot after prebuilt re-run error', { stepId: step.rstep_id, error: restoreErr.message });
        });
      });
      return;
    }

    runDiscoverStep({
      db,
      serverId: server_id,
      bankId,
      queryDepth: step.rstep_action_type,
      intentText: step.rstep_intent_text,
      selections: step.rstep_selections || [],
      options: step.rstep_parameters || {},
      rsId: step.rs_id,
      rstepId: step.rstep_id,
    })
      .then((result) => {
        if (!result.success) {
          logger.warn('Re-run failed; restoring step snapshot', { stepId: step.rstep_id, error: result.error, code: result.code });
          return restoreStepSnapshot(db, step.rstep_id, snapshot, { errorMessage: result.error }).then(() => result);
        }
        return result;
      })
      .catch((err) => {
        logger.error('Re-run runner error; restoring step snapshot', { stepId: step.rstep_id, error: err.message });
        return restoreStepSnapshot(db, step.rstep_id, snapshot, { errorMessage: err.message }).then(() => ({ success: false, error: err.message, code: 'RERUN_FAILED' }));
      });
  });

  sendResponse({
    res,
    status: 202,
    data: {
      step_id: step.rstep_id,
      session_id: step.rs_id,
      status: 'running',
      action_type: step.rstep_action_type,
    },
    logger,
    method: 'POST',
    path: '/research/steps/:id/rerun',
    duration: Date.now() - start,
  });
});

/**
 * @openapi
 * /research/banks/{bankId}/graph:
 *   get:
 *     summary: Get the global entity graph for a bank
 *     description: Returns the normalized Hindsight entity graph for the selected bank, with architxt entity labels/types resolved.
 *     tags: [Research]
 *     parameters:
 *       - in: path
 *         name: bankId
 *         required: true
 *         schema:
 *           type: string
 *       - in: query
 *         name: server_id
 *         required: true
 *         schema:
 *           type: integer
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *       - in: query
 *         name: min_count
 *         schema:
 *           type: integer
 *     responses:
 *       200:
 *         description: Graph data
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 nodes:
 *                   type: array
 *                 edges:
 *                   type: array
 */
router.get('/banks/:bankId/graph', async (req, res) => {
  const start = Date.now();
  const serverId = parseInt(req.query.server_id, 10);
  const bankId = req.params.bankId;
  const { limit, min_count } = req.query;

  if (!serverId || !bankId) {
    sendResponse({ res, status: 400, error: 'server_id and bank_id are required', code: 'VALIDATION_ERROR', logger, method: 'GET', path: `/research/banks/${bankId}/graph`, duration: Date.now() - start });
    return;
  }

  try {
    const result = await normalizeHindsightGraph(serverId, bankId, db, {
      limit: limit ? Number.parseInt(limit, 10) : 1000,
      min_count: min_count ? Number.parseInt(min_count, 10) : undefined,
    });
    if (!result.success) {
      sendResponse({ res, status: 502, error: result.error, code: result.code || 'GRAPH_FAILED', logger, method: 'GET', path: `/research/banks/${bankId}/graph`, duration: Date.now() - start });
      return;
    }
    sendResponse({ res, status: 200, data: { nodes: result.nodes, edges: result.edges }, logger, method: 'GET', path: `/research/banks/${bankId}/graph`, duration: Date.now() - start });
  } catch (err) {
    logger.error('Research bank graph route error', { serverId, bankId, error: err.message });
    sendResponse({ res, status: 500, error: err.message, code: 'INTERNAL_ERROR', logger, method: 'GET', path: `/research/banks/${bankId}/graph`, duration: Date.now() - start });
  }
});

export default router;
