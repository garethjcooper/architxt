import { Router } from 'express';
import { db } from '../db/connection.js';
import { createLogger } from '../utils/logger.js';
import { sendResponse, validateId } from '../utils/route-helpers.js';
import { mapErrorToStatus } from '../utils/db-helpers.js';
import { runDiscoverStep } from '../services/research/agent.js';
import { normalizeHindsightGraph, normalizeHindsightEntities } from '../services/research/halo-graph.js';
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
  listSessionsByServerBank,
  updateSession,
  deleteSessionWithSteps,
  createSessionPage,
  updateCuratedPage,
} from '../db/crud/research.js';

import { discoverMentalModelsByRoles } from '../services/research/mental-model-discovery.js';
import { runPrebuiltResearch } from '../services/research/prebuilt-research.js';
import { findEligibleTemplateModels } from '../services/research/template-eligibility.js';
import { getMentalModel as getHindsightMentalModel, refreshMentalModel as refreshHindsightMentalModel } from '../services/hindsight/mental-models.js';
import { toEnvelope } from '../services/contextual-graph/to-envelope.js';
import { normalizeEnvelopeForApi } from '../services/contextual-graph/normalize-model-output.js';
import { parseJsonString } from '../prompts/graph-parser.js';

/**
 * Extract the first balanced JSON object/array from a string that may contain
 * trailing garbage after the JSON. This is stricter than the regex-based loose
 * extractor and avoids over-matching when trailing text also contains braces.
 */
function extractBalancedJson(text) {
  if (typeof text !== 'string' || !text.trim()) return null;
  const start = text.search(/[\{\[]/);
  if (start === -1) return null;
  const opener = text[start];
  const closer = opener === '{' ? '}' : ']';
  let depth = 1;
  let inString = false;
  let escapeNext = false;
  for (let i = start + 1; i < text.length; i += 1) {
    const ch = text[i];
    if (inString) {
      if (escapeNext) {
        escapeNext = false;
      } else if (ch === '\\') {
        escapeNext = true;
      } else if (ch === '"') {
        inString = false;
      }
    } else if (ch === '"') {
      inString = true;
    } else if (ch === opener) {
      depth += 1;
    } else if (ch === closer) {
      depth -= 1;
      if (depth === 0) {
        try {
          return JSON.parse(text.slice(start, i + 1));
        } catch {
          return null;
        }
      }
    }
  }
  return null;
}
import { loadEntityCatalog } from '../prompts/entity-catalog.js';
import { parseSectionDirectives } from '../prompts/section-directives.js';

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
  const roles = parameters.roles || [];
  const selections = step.rstep_selections || [];
  const entities = selections
    .filter((s) => s.kind === 'entity')
    .map((s) => (s.id ? String(s.id) : undefined))
    .filter(Boolean);

  if (!entities.length || !roles.length) {
    await updateStep(db, step.rstep_id, {
      rstep_status: 'failed',
      rstep_error_message: 'Prebuilt step is missing entities or roles',
      rstep_calls: [],
      rstep_tool_calls_used: 0,
    });
    return;
  }

  const prebuiltStart = Date.now();
  const result = await runPrebuiltResearch(db, serverId, bankId, { entities, roles });
  const prebuiltDuration = Date.now() - prebuiltStart;
  const prebuiltRequestBody = { server_id: serverId, bank_id: bankId, entities, roles };
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
  const mergedTables = [];
  const mergedDiagrams = [];
  const narratives = [];
  for (const roleResult of result.roles || []) {
    const found = (roleResult.entities || [])
      .filter((e) => e.found)
      .map((e) => e.entity);
    const modelNames = (roleResult.entities || [])
      .flatMap((e) => (e.model_results || []).filter((m) => m.found).map((m) => m.name))
      .filter((v, i, a) => a.indexOf(v) === i);
    const roleLabel = roleResult.role.replace(/^sys_/, '').replace(/_/g, ' ');
    const lines = [`## ${roleLabel}`, ''];
    const roleNarratives = roleResult.result?.narratives;
    if (roleNarratives && roleNarratives.length > 0) {
      lines.push(roleNarratives.map((n) => n.narrative).join('\n\n'));
    } else {
      lines.push(`- Entities covered: ${found.join(', ') || 'none'}`);
      lines.push(`- Models applied: ${modelNames.join(', ') || 'none'}`);
    }
    narratives.push(lines.join('\n'));

    const jsonResult = roleResult.result?.json_result;
    if (jsonResult) {
      const graphs = Array.isArray(jsonResult) ? jsonResult : [jsonResult];
      for (const g of graphs) {
        if (!g || !Array.isArray(g.nodes)) continue;
        for (const n of g.nodes) {
          if (!mergedGraph.nodes.some((x) => x.id === n.id)) mergedGraph.nodes.push(n);
        }
        for (const e of g.edges || []) {
          const key = e.id || `${e.from}|${e.to}|${e.type}`;
          if (!mergedGraph.edges.some((x) => (x.id || `${x.from}|${x.to}|${x.type}`) === key)) {
            mergedGraph.edges.push(e);
          }
        }
      }
    }
    if (roleResult.result?.tables && roleResult.result.tables.length > 0) {
      mergedTables.push(...roleResult.result.tables);
    }
    if (roleResult.result?.diagrams && roleResult.result.diagrams.length > 0) {
      mergedDiagrams.push(...roleResult.result.diagrams);
    }
  }

  const foundCount = (result.roles || []).reduce((sum, r) => sum + (r.found_count || 0), 0);
  const missingCount = (result.roles || []).reduce((sum, r) => sum + (r.missing_count || 0), 0);

  await updateStep(db, step.rstep_id, {
    rstep_canvas_state: { graph: mergedGraph, tables: mergedTables, diagrams: mergedDiagrams },
    rstep_synthesis: { narrative: narratives.join('\n\n') },
    rstep_status: 'completed',
    rstep_error_message: null,
    rstep_tool_calls_used: 1,
    rstep_calls: [
      buildPrebuiltCall('success', {
        response_summary: {
          roles: (result.roles || []).map((r) => r.role),
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
  server_id: dbRow.rs_server_id,
  bank_id: dbRow.rs_bank_id,
  viewpoint_ids: dbRow.rs_viewpoint_ids,
  scope_entity_ids: dbRow.rs_scope_entity_ids,
  status: dbRow.rs_status,
  current_step_id: dbRow.rs_current_step_id,
  created_at: dbRow.rs_created_at,
  updated_at: dbRow.rs_updated_at,
});

const toApiStepSummary = (dbRow) => {
  const isCurated = dbRow.rstep_action_type === 'curated_page';
  const envelope = isCurated
    ? normalizeEnvelopeForApi(dbRow.rstep_envelope ?? {
        narratives: [],
        graph: dbRow.rstep_canvas_state?.graph ?? { nodes: [], edges: [] },
        tables: dbRow.rstep_canvas_state?.tables ?? [],
        diagrams: dbRow.rstep_canvas_state?.diagrams ?? [],
      })
    : undefined;
  return {
    id: dbRow.rstep_id,
    session_id: dbRow.rs_id,
    parent_step_id: dbRow.rstep_parent_step_id,
    intent_text: dbRow.rstep_intent_text,
    raw_query: dbRow.rstep_raw_query || null,
    action_type: dbRow.rstep_action_type,
    parameters: dbRow.rstep_parameters,
    created_at: dbRow.rstep_created_at,
    selections: dbRow.rstep_selections,
    viewpoint_ids: dbRow.rstep_viewpoint_ids,
    canvas: dbRow.rstep_canvas_state,
    synthesis: dbRow.rstep_synthesis,
    envelope,
    tool_calls_used: dbRow.rstep_tool_calls_used,
    calls: dbRow.rstep_calls,
    status: dbRow.rstep_status || 'completed',
    error_message: dbRow.rstep_error_message || null,
  };
};

const toApiStep = (dbRow) => {
  const isCurated = dbRow.rstep_action_type === 'curated_page';
  const envelope = isCurated
    ? normalizeEnvelopeForApi(dbRow.rstep_envelope ?? {
        narratives: [],
        graph: dbRow.rstep_canvas_state?.graph ?? { nodes: [], edges: [] },
        tables: dbRow.rstep_canvas_state?.tables ?? [],
        diagrams: dbRow.rstep_canvas_state?.diagrams ?? [],
      })
    : undefined;
  return {
    id: dbRow.rstep_id,
    session_id: dbRow.rs_id,
    parent_step_id: dbRow.rstep_parent_step_id,
    intent_text: dbRow.rstep_intent_text,
    raw_query: dbRow.rstep_raw_query || null,
    action_type: dbRow.rstep_action_type,
    parameters: dbRow.rstep_parameters,
    selections: dbRow.rstep_selections,
    viewpoint_ids: dbRow.rstep_viewpoint_ids,
    canvas: dbRow.rstep_canvas_state,
    synthesis: dbRow.rstep_synthesis,
    envelope,
    tool_calls_used: dbRow.rstep_tool_calls_used,
    calls: dbRow.rstep_calls,
    status: dbRow.rstep_status || 'completed',
    error_message: dbRow.rstep_error_message || null,
    created_at: dbRow.rstep_created_at,
  };
};

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
 *                 enum: [prebuilt, recall, reflect, synthesize, models, templates]
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
      include_source_facts,
      tags,
      tags_match,
      section_focus,
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
      ...(include_source_facts !== undefined && { include_source_facts }),
      ...(tags !== undefined && { tags }),
      ...(tags_match !== undefined && { tags_match }),
      ...(selections !== undefined && { selections }),
      ...(section_focus !== undefined && { section_focus }),
    };

    // Normalize Reflect provenance so every recorded step has a complete,
    // reproducible settings snapshot.
    if (effectiveDepth === 'reflect') {
      handlerOptions.budget = handlerOptions.budget ?? 'low';
      handlerOptions.max_tokens = handlerOptions.max_tokens ?? 4096;
      handlerOptions.fact_types = handlerOptions.fact_types ?? ['world', 'observation'];
      handlerOptions.exclude_mental_models = handlerOptions.exclude_mental_models ?? false;
      handlerOptions.include_source_facts = handlerOptions.include_source_facts ?? false;
    }

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
      rstep_raw_query: req.body.raw_query || intent_text,
      rstep_selections: selections || [],
      rstep_action_type: effectiveDepth,
      rstep_parameters: handlerOptions,
      rstep_viewpoint_ids: viewpoint_ids,
      rstep_canvas_state: { graph: { nodes: [], edges: [] }, tables: [], diagrams: [] },
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
 *     summary: List eligible derived mental models across dimensions (legacy dimension-based discovery)
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
  sendResponse({ res, status: 410, error: 'Eligible mental models by dimensions is deprecated. Use /research/prebuilt or /research/eligible-template-models.', code: 'DEPRECATED', logger, method: 'POST', path: '/research/eligible-mental-models', duration: 0 });
});

/**
 * @openapi
 * /research/eligible-template-models:
 *   post:
 *     summary: List eligible template-derived mental models for selected entities
 *     tags: [Research]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [entities]
 *             properties:
 *               server_id: { type: integer }
 *               bank_id: { type: string }
 *               entities: { type: array, items: { type: string } }
 *     responses:
 *       200:
 *         description: Per-template matched entity list with derived ext_ids
 *       400:
 *         description: Invalid input
 *       500:
 *         description: Database error
 */
router.post('/eligible-template-models', async (req, res) => {
  const start = Date.now();
  try {
    const { server_id, bank_id, entities } = req.body;

    if (!server_id || typeof server_id !== 'number') {
      sendResponse({ res, status: 400, error: 'server_id is required', code: 'VALIDATION_ERROR', logger, method: 'POST', path: '/research/eligible-template-models', duration: Date.now() - start });
      return;
    }
    if (!bank_id || typeof bank_id !== 'string') {
      sendResponse({ res, status: 400, error: 'bank_id is required', code: 'VALIDATION_ERROR', logger, method: 'POST', path: '/research/eligible-template-models', duration: Date.now() - start });
      return;
    }
    if (!Array.isArray(entities) || entities.length === 0) {
      sendResponse({ res, status: 400, error: 'entities must be a non-empty array', code: 'VALIDATION_ERROR', logger, method: 'POST', path: '/research/eligible-template-models', duration: Date.now() - start });
      return;
    }

    const result = findEligibleTemplateModels(db, { entities, bankId: bank_id, serverId: server_id });
    if (!result.success) {
      sendResponse({ res, status: mapErrorToStatus(result.code), error: result.error, code: result.code, logger, method: 'POST', path: '/research/eligible-template-models', duration: Date.now() - start });
      return;
    }

    sendResponse({ res, status: 200, data: result, logger, method: 'POST', path: '/research/eligible-template-models', duration: Date.now() - start });
  } catch (err) {
    logger.error('Research eligible-template-models route error', { error: err.message, stack: err.stack });
    sendResponse({ res, status: 500, error: err.message, code: 'UNKNOWN_ERROR', logger, method: 'POST', path: '/research/eligible-template-models', duration: Date.now() - start });
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
 *             required: [server_id, bank_id, entities, roles]
 *             properties:
 *               server_id: { type: integer }
 *               bank_id: { type: string }
 *               entities: { type: array, items: { type: string } }
 *               roles: { type: array, items: { type: string } }
 *               session_id:
 *                 type: integer
 *                 nullable: true
 *     responses:
 *       200:
 *         description: Per-role entity results with merged narrative/graph output
 *       400:
 *         description: Invalid input
 *       500:
 *         description: Prebuilt research error
 */
router.post('/prebuilt', async (req, res) => {
  const start = Date.now();
  try {
    const { server_id, bank_id, entities, roles, session_id } = req.body;

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
    if (!Array.isArray(roles) || roles.length === 0) {
      sendResponse({ res, status: 400, error: 'roles must be a non-empty array', code: 'VALIDATION_ERROR', logger, method: 'POST', path: '/research/prebuilt', duration: Date.now() - start });
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
      rstep_raw_query: req.body.raw_query || intentText,
      rstep_selections: entities.map((id) => ({ id, kind: 'entity' })),
      rstep_action_type: 'prebuilt',
      rstep_parameters: { roles },
      rstep_viewpoint_ids: [],
      rstep_canvas_state: { graph: { nodes: [], edges: [] }, tables: [], diagrams: [] },
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
    const result = await runPrebuiltResearch(db, server_id, bank_id, { entities, roles });
    const prebuiltDuration = Date.now() - prebuiltStart;
    const prebuiltRequestBody = { server_id, bank_id, entities, roles, session_id: rsId };
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
    const mergedTables = [];
    const mergedDiagrams = [];
    const narratives = [];
    const parseErrors = [];
    for (const roleResult of result.roles || []) {
      const found = (roleResult.entities || [])
        .filter((e) => e.found)
        .map((e) => e.entity);
      const modelNames = (roleResult.entities || [])
        .flatMap((e) => (e.model_results || []).filter((m) => m.found).map((m) => m.name))
        .filter((v, i, a) => a.indexOf(v) === i);
      const roleLabel = roleResult.role.replace(/^sys_/, '').replace(/_/g, ' ');
      const lines = [`## ${roleLabel}`, ''];
      const roleNarratives = roleResult.result?.narratives;
      if (roleNarratives && roleNarratives.length > 0) {
        lines.push(roleNarratives.map((n) => n.narrative).join('\n\n'));
      } else {
        lines.push(`- Entities covered: ${found.join(', ') || 'none'}`);
        lines.push(`- Models applied: ${modelNames.join(', ') || 'none'}`);
      }
      if (roleResult.result?.errors && roleResult.result.errors.length > 0) {
        lines.push('');
        lines.push('Errors:');
        for (const err of roleResult.result.errors) {
          lines.push(`- ${err.model}: ${err.error}`);
        }
        parseErrors.push(...roleResult.result.errors);
      }
      narratives.push(lines.join('\n'));

      const jsonResult = roleResult.result?.json_result;
      if (jsonResult) {
        const graphs = Array.isArray(jsonResult) ? jsonResult : [jsonResult];
        for (const g of graphs) {
          if (!g || !Array.isArray(g.nodes)) continue;
          for (const n of g.nodes) {
            if (!mergedGraph.nodes.some((x) => x.id === n.id)) mergedGraph.nodes.push(n);
          }
          for (const e of g.edges || []) {
            const key = e.id || `${e.from}|${e.to}|${e.type}`;
            if (!mergedGraph.edges.some((x) => (x.id || `${x.from}|${x.to}|${x.type}`) === key)) {
              mergedGraph.edges.push(e);
            }
          }
        }
      }
      if (roleResult.result?.tables && roleResult.result.tables.length > 0) {
        mergedTables.push(...roleResult.result.tables);
      }
      if (roleResult.result?.diagrams && roleResult.result.diagrams.length > 0) {
        mergedDiagrams.push(...roleResult.result.diagrams);
      }
    }

    const foundCount = (result.roles || []).reduce((sum, r) => sum + (r.found_count || 0), 0);
    const missingCount = (result.roles || []).reduce((sum, r) => sum + (r.missing_count || 0), 0);

    await updateStep(db, stepId, {
      rstep_canvas_state: { graph: mergedGraph, tables: mergedTables, diagrams: mergedDiagrams },
      rstep_synthesis: { narrative: narratives.join('\n\n') },
      rstep_status: 'completed',
      rstep_error_message: parseErrors.length > 0 ? `Some mental models could not be parsed. ${parseErrors.map((e) => `${e.model}: ${e.error}`).join('; ')}` : null,
      rstep_tool_calls_used: 1,
      rstep_calls: [
        buildPrebuiltCall('success', {
          response_summary: {
            roles: (result.roles || []).map((r) => r.role),
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
 * /research/prebuilt/oneshot:
 *   post:
 *     summary: Run prebuilt research without creating a session or step
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
router.post('/prebuilt/oneshot', async (req, res) => {
  const start = Date.now();
  try {
    const { server_id, bank_id, entities, dimensions } = req.body;

    if (!server_id || typeof server_id !== 'number') {
      sendResponse({ res, status: 400, error: 'server_id is required', code: 'VALIDATION_ERROR', logger, method: 'POST', path: '/research/prebuilt/oneshot', duration: Date.now() - start });
      return;
    }
    if (!bank_id || typeof bank_id !== 'string') {
      sendResponse({ res, status: 400, error: 'bank_id is required', code: 'VALIDATION_ERROR', logger, method: 'POST', path: '/research/prebuilt/oneshot', duration: Date.now() - start });
      return;
    }
    if (!Array.isArray(entities) || entities.length === 0) {
      sendResponse({ res, status: 400, error: 'entities must be a non-empty array', code: 'VALIDATION_ERROR', logger, method: 'POST', path: '/research/prebuilt/oneshot', duration: Date.now() - start });
      return;
    }
    if (!Array.isArray(dimensions) || dimensions.length === 0) {
      sendResponse({ res, status: 400, error: 'dimensions must be a non-empty array', code: 'VALIDATION_ERROR', logger, method: 'POST', path: '/research/prebuilt/oneshot', duration: Date.now() - start });
      return;
    }

    const result = await runPrebuiltResearch(db, server_id, bank_id, { entities, roles });
    if (!result.success) {
      sendResponse({ res, status: mapErrorToStatus(result.code), error: result.error, code: result.code, logger, method: 'POST', path: '/research/prebuilt/oneshot', duration: Date.now() - start });
      return;
    }

    sendResponse({
      res,
      status: 200,
      data: result,
      logger,
      method: 'POST',
      path: '/research/prebuilt/oneshot',
      duration: Date.now() - start,
    });
  } catch (err) {
    logger.error('Research prebuilt oneshot route error', { error: err.message, stack: err.stack });
    sendResponse({ res, status: 500, error: err.message, code: 'UNKNOWN_ERROR', logger, method: 'POST', path: '/research/prebuilt/oneshot', duration: Date.now() - start });
  }
});

/**
 * @openapi
 * /research/mental-models:
 *   post:
 *     summary: Discover mental models for entities across template roles
 *     tags: [Research]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [server_id, bank_id, entities, roles]
 *             properties:
 *               server_id: { type: integer }
 *               bank_id: { type: string }
 *               entities: { type: array, items: { type: string } }
 *               roles: { type: array, items: { type: string } }
 *     responses:
 *       200:
 *         description: Per-role candidate list with found/missing status
 *       400:
 *         description: Invalid input
 *       500:
 *         description: Discovery error
 */
router.post('/mental-models', async (req, res) => {
  const start = Date.now();
  try {
    const { server_id, bank_id, entities, roles } = req.body;

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
    if (!Array.isArray(roles) || roles.length === 0) {
      sendResponse({ res, status: 400, error: 'roles must be a non-empty array', code: 'VALIDATION_ERROR', logger, method: 'POST', path: '/research/mental-models', duration: Date.now() - start });
      return;
    }

    const result = await discoverMentalModelsByRoles(db, server_id, bank_id, { entities, roles });
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
 * /research/mental-models/health:
 *   post:
 *     summary: Lightweight health check for mental-model ext_ids
 *     description: |
 *       For each provided mental model, fetches the Hindsight content by ext_id
 *       and reports whether it was found and whether its content parsed cleanly.
 *     tags: [Research]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [server_id, bank_id, models]
 *             properties:
 *               server_id: { type: integer }
 *               bank_id: { type: string }
 *               models:
 *                 type: array
 *                 items:
 *                   type: object
 *                   required: [ext_id]
 *                   properties:
 *                     ext_id: { type: string }
 *                     returns: { type: string, enum: [json, narrative], default: json }
 *     responses:
 *       200:
 *         description: Per-model health results
 */
router.post('/mental-models/health', async (req, res) => {
  const start = Date.now();
  try {
    const { server_id, bank_id, models } = req.body;

    if (!server_id || typeof server_id !== 'number') {
      sendResponse({ res, status: 400, error: 'server_id is required', code: 'VALIDATION_ERROR', logger, method: 'POST', path: '/research/mental-models/health', duration: Date.now() - start });
      return;
    }
    if (!bank_id || typeof bank_id !== 'string') {
      sendResponse({ res, status: 400, error: 'bank_id is required', code: 'VALIDATION_ERROR', logger, method: 'POST', path: '/research/mental-models/health', duration: Date.now() - start });
      return;
    }
    if (!Array.isArray(models) || models.length === 0) {
      sendResponse({ res, status: 400, error: 'models must be a non-empty array', code: 'VALIDATION_ERROR', logger, method: 'POST', path: '/research/mental-models/health', duration: Date.now() - start });
      return;
    }

    const results = await Promise.all(models.map(async (model) => {
      const extId = model.ext_id;
      const returns = (model.returns || 'json').toLowerCase();
      if (!extId || typeof extId !== 'string') {
        return { ext_id: extId, healthy: false, error: 'ext_id is required' };
      }

      const hindsightResult = await getHindsightMentalModel(server_id, bank_id, extId, {
        detail: 'full',
        timeoutMs: 15000,
      });

      if (!hindsightResult.success || !hindsightResult.mentalModel) {
        return {
          ext_id: extId,
          healthy: false,
          error: hindsightResult.error || 'Mental model not found in Hindsight',
        };
      }

      const content = hindsightResult.mentalModel.reflect_response?.structured_output ?? null;
      if (!content || typeof content !== 'object') {
        return {
          ext_id: extId,
          healthy: false,
          found: true,
          content: null,
          content_length: 0,
          error: 'Mental-model reflect_response.structured_output is empty or missing',
        };
      }

      const graph = content.graph && typeof content.graph === 'object' ? content.graph : { nodes: [], edges: [] };
      const healthy = Array.isArray(graph.nodes) && graph.nodes.length > 0;
      return {
        ext_id: extId,
        healthy,
        found: true,
        content_length: JSON.stringify(content).length,
        graph_present: healthy,
        node_count: graph?.nodes?.length ?? 0,
        edge_count: graph?.edges?.length ?? 0,
        error: healthy ? null : 'Mental-model structured output has no graph nodes',
      };
    }));

    sendResponse({
      res,
      status: 200,
      data: { results },
      logger,
      method: 'POST',
      path: '/research/mental-models/health',
      duration: Date.now() - start,
    });
  } catch (err) {
    logger.error('Research mental-models health route error', { error: err.message, stack: err.stack });
    sendResponse({ res, status: 500, error: err.message, code: 'UNKNOWN_ERROR', logger, method: 'POST', path: '/research/mental-models/health', duration: Date.now() - start });
  }
});

/**
 * @openapi
 * /research/mental-models/refresh:
 *   post:
 *     summary: Refresh a single Hindsight mental model
 *     description: |
 *       Calls the Hindsight refresh endpoint for the given mental-model ext_id
 *       and tracks the async operation in pending_operations.
 *     tags: [Research]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [server_id, bank_id, ext_id]
 *             properties:
 *               server_id: { type: integer }
 *               bank_id: { type: string }
 *               ext_id: { type: string, description: 'Hindsight mental_model_id' }
 *     responses:
 *       200:
 *         description: Refresh queued
 *       400:
 *         description: Validation error
 *       502:
 *         description: Hindsight server error
 */
router.post('/mental-models/refresh', async (req, res) => {
  const serverId = parseInt(req.body.server_id, 10);
  const bankId = req.body.bank_id;
  const extId = req.body.ext_id;

  if (!serverId || !bankId || !extId) {
    return res.status(400).json({ error: 'server_id, bank_id, and ext_id are required', code: 'VALIDATION_ERROR' });
  }

  const start = Date.now();
  try {
    const refreshResult = await refreshHindsightMentalModel(serverId, bankId, extId);
    if (!refreshResult.success) {
      return res.status(502).json({ error: refreshResult.error, code: 'REFRESH_FAILED' });
    }

    // refreshHindsightMentalModel already creates the pending_operations row;
    // reuse its pop_id instead of creating a duplicate.
    if (!refreshResult.popId) {
      logger.warn('Mental-model refresh succeeded but pending operation was not tracked', { serverId, bankId, extId, operationId: refreshResult.operationId });
    }

    logger.info('Mental-model refresh queued', { serverId, bankId, extId, operationId: refreshResult.operationId, popId: refreshResult.popId });
    sendResponse({
      res,
      status: 200,
      data: { operation_id: refreshResult.operationId, pop_id: refreshResult.popId || null, status: refreshResult.status },
      logger,
      method: 'POST',
      path: '/research/mental-models/refresh',
      duration: Date.now() - start,
    });
  } catch (err) {
    logger.error('Research mental-models refresh failed', { serverId, bankId, extId, error: err.message, stack: err.stack });
    res.status(500).json({ error: err.message, code: 'INTERNAL_ERROR' });
  }
});

/**
 * @openapi
 * /research/mental-models/content:
 *   get:
 *     summary: Fetch raw Hindsight mental-model content
 *     description: |
 *       Returns the latest content for a Hindsight mental model ext_id. The raw
 *       content is returned for inspection, along with a normalized envelope
 *       suitable for rendering with the contextual-graph viewer.
 *     tags: [Research]
 *     parameters:
 *       - in: query
 *         name: server_id
 *         required: true
 *         schema: { type: integer }
 *       - in: query
 *         name: bank_id
 *         required: true
 *         schema: { type: string }
 *       - in: query
 *         name: ext_id
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: Content retrieved
 *       400:
 *         description: Validation error
 *       404:
 *         description: Model not found in Hindsight
 *       502:
 *         description: Hindsight server error
 */
router.get('/mental-models/content', async (req, res) => {
  const serverId = parseInt(req.query.server_id, 10);
  const bankId = req.query.bank_id;
  const extId = req.query.ext_id;
  const start = Date.now();

  if (!serverId || !bankId || !extId) {
    return res.status(400).json({ error: 'server_id, bank_id, and ext_id are required', code: 'VALIDATION_ERROR' });
  }

  try {
    logger.info('Research mental-models content request', { serverId, bankId, extId });
    const result = await getHindsightMentalModel(serverId, bankId, extId, { detail: 'full' });
    if (!result.success) {
      const status = result.code === 'NOT_FOUND' ? 404 : 502;
      return res.status(status).json({ error: result.error, code: result.code || 'FETCH_FAILED' });
    }

    const model = result.mentalModel || {};
    const structuredOutput = model.reflect_response?.structured_output ?? null;

    let rawContent;
    let parsedContent = null;
    let parseError = null;

    if (structuredOutput && typeof structuredOutput === 'object' && !Array.isArray(structuredOutput)) {
      rawContent = JSON.stringify(structuredOutput);
      parsedContent = structuredOutput;
    } else {
      rawContent = model.content ?? null;
      if (typeof rawContent === 'string' && rawContent.trim()) {
        try {
          parsedContent = JSON.parse(rawContent);
        } catch (err) {
          parseError = err.message;
          // Some stored mental-model content is the valid JSON envelope followed
          // by extra LLM text (e.g. trailing prose after the closing brace). Fall
          // back to the loose JSON extractors that pull the first balanced {...}
          // or [...] payload and ignore surrounding/markdown content.
          parsedContent = parseJsonString(rawContent) || extractBalancedJson(rawContent);
        }
      } else if (rawContent && typeof rawContent === 'object' && !Array.isArray(rawContent)) {
        parsedContent = rawContent;
      }
    }

    const catalogEntities = await loadEntityCatalog(db);
    const knownCatalog = new Map(catalogEntities.map((e) => [e.id, e]));

    const envelope = parsedContent
      ? toEnvelope(parsedContent, { knownCatalog, activity: 'mental-model', mode: 'generic', preserveParallelEdges: true })
      : {
          narratives: [],
          graph: { name: '', nodes: [], edges: [] },
          tables: [],
          diagrams: [],
        };

    const hasRawData = parsedContent
      && ((Array.isArray(parsedContent.graph?.nodes) && parsedContent.graph.nodes.length > 0)
        || (Array.isArray(parsedContent.graph?.edges) && parsedContent.graph.edges.length > 0)
        || (Array.isArray(parsedContent.tables) && parsedContent.tables.length > 0)
        || (Array.isArray(parsedContent.diagrams) && parsedContent.diagrams.length > 0)
        || (Array.isArray(parsedContent.narratives) && parsedContent.narratives.some((n) => typeof n.narrative === 'string' && n.narrative.trim().length > 0)));

    const hasEnvelopeData = (envelope.graph?.nodes?.length ?? 0) > 0
      || (envelope.graph?.edges?.length ?? 0) > 0
      || (envelope.tables?.length ?? 0) > 0
      || (envelope.diagrams?.length ?? 0) > 0
      || envelope.narratives?.some((n) => n.narrative?.trim().length > 0);

    if (parseError && hasRawData) {
      logger.warn('Mental-model content required loose JSON extraction', {
        extId,
        parseError,
        rawContentLength: typeof rawContent === 'string' ? rawContent.length : null,
      });
    }

    if (hasRawData && !hasEnvelopeData) {
      logger.warn('Mental-model content normalization produced an empty envelope despite raw structured content', {
        extId,
        rawGraphNodeCount: Array.isArray(parsedContent?.graph?.nodes) ? parsedContent.graph.nodes.length : null,
        rawGraphEdgeCount: Array.isArray(parsedContent?.graph?.edges) ? parsedContent.graph.edges.length : null,
        knownCatalogSize: knownCatalog.size,
      });
    }

    logger.info('Research mental-models content response', {
      extId,
      rawContentType: typeof rawContent,
      parsedContentType: parsedContent != null ? typeof parsedContent : null,
      envelopeNodes: envelope.graph?.nodes?.length ?? 0,
      envelopeEdges: envelope.graph?.edges?.length ?? 0,
      usedLooseExtraction: parseError != null && parsedContent != null,
    });

    sendResponse({
      res,
      status: 200,
      data: {
        ext_id: extId,
        found: true,
        content: rawContent,
        content_hash: model.content_hash ?? null,
        updated_at: model.updated_at ?? null,
        envelope,
      },
      logger,
      method: 'GET',
      path: '/research/mental-models/content',
      duration: Date.now() - start,
    });
  } catch (err) {
    logger.error('Research mental-models content fetch failed', { serverId, bankId, extId, error: err.message, stack: err.stack });
    res.status(500).json({ error: err.message, code: 'INTERNAL_ERROR' });
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
      max_tokens,
      section_focus,
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

    const parsed = section_focus ? { sectionFocus: section_focus, intentText: intent_text } : parseSectionDirectives(intent_text);

    const handlerOptions = {
      ...(max_tokens !== undefined && { max_tokens }),
      ...(parsed.sectionFocus !== undefined && { section_focus: parsed.sectionFocus }),
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
      // Store the raw user query so "Use details" / reuse can restore the full
      // AQL including block directives. The parsed/stripped intent is passed to
      // the agent below while the original query lives in the step record.
      rstep_intent_text: intent_text,
      rstep_raw_query: req.body.raw_query || intent_text,
      rstep_selections: source_step_ids.map((id) => ({ id, kind: 'step' })),
      rstep_action_type: 'synthesize',
      rstep_parameters: handlerOptions,
      rstep_viewpoint_ids: [],
      rstep_canvas_state: { graph: { nodes: [], edges: [] }, tables: [], diagrams: [] },
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
        intentText: parsed.intentText,
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
 *             required: [server_id, bank_id, viewpoint_ids]
 *             properties:
 *               title:
 *                 type: string
 *               description:
 *                 type: string
 *               server_id:
 *                 type: integer
 *               bank_id:
 *                 type: string
 *               viewpoint_ids:
 *                 type: array
 *                 items: { type: integer }
 */
router.post('/sessions', async (req, res) => {
  const start = Date.now();
  const { title, description, server_id, bank_id, viewpoint_ids, scope_entity_ids } = req.body;

  if (!server_id || typeof server_id !== 'number') {
    sendResponse({ res, status: 400, error: 'server_id is required', code: 'VALIDATION_ERROR', logger, method: 'POST', path: '/research/sessions', duration: Date.now() - start });
    return;
  }
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
    rs_server_id: server_id,
    rs_bank_id: bank_id,
    rs_viewpoint_ids: viewpoint_ids,
    rs_scope_entity_ids: scope_entity_ids ?? [],
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
 * /research/sessions:
 *   get:
 *     summary: List research sessions for a server and bank
 *     tags: [Research]
 *     parameters:
 *       - in: query
 *         name: server_id
 *         required: true
 *         schema:
 *           type: integer
 *       - in: query
 *         name: bank_id
 *         required: true
 *         schema:
 *           type: string
 */
router.get('/sessions', async (req, res) => {
  const start = Date.now();
  const serverId = parseInt(req.query.server_id, 10);
  const bankId = req.query.bank_id;
  if (!serverId || !bankId || typeof bankId !== 'string') {
    sendResponse({ res, status: 400, error: 'server_id and bank_id are required', code: 'VALIDATION_ERROR', logger, method: 'GET', path: '/research/sessions', duration: Date.now() - start });
    return;
  }

  const result = await listSessionsByServerBank(db, serverId, bankId);
  if (!result.success) {
    sendResponse({ res, status: 500, error: result.error, code: result.code || 'DATABASE_ERROR', logger, method: 'GET', path: '/research/sessions', duration: Date.now() - start });
    return;
  }
  sendResponse({ res, status: 200, data: (result.data || []).map(toApiSession), logger, method: 'GET', path: '/research/sessions', duration: Date.now() - start });
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

  const { title, description, status, scope_entity_ids } = req.body;
  const updateData = {};
  if (title !== undefined) updateData.rs_title = title;
  if (description !== undefined) updateData.rs_description = description;
  if (status !== undefined) updateData.rs_status = status;
  if (scope_entity_ids !== undefined) updateData.rs_scope_entity_ids = scope_entity_ids;

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
 * /research/sessions/{id}/pages:
 *   post:
 *     summary: Create a new curated page inside a research session
 *     tags: [Research]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [title]
 *             properties:
 *               title:
 *                 type: string
 *     responses:
 *       201:
 *         description: Curated page created
 *       400:
 *         description: Invalid input
 *       404:
 *         description: Session not found
 */
router.post('/sessions/:id/pages', async (req, res) => {
  const start = Date.now();
  const idCheck = validateId({ req, res, paramName: 'id', logger, path: '/research/sessions/:id/pages', start });
  if (!idCheck.valid) return;

  const { title } = req.body;
  if (!title || typeof title !== 'string' || !title.trim()) {
    sendResponse({ res, status: 400, error: 'title is required', code: 'VALIDATION_ERROR', logger, method: 'POST', path: '/research/sessions/:id/pages', duration: Date.now() - start });
    return;
  }

  const sessionResult = await getSession(db, idCheck.id);
  if (!sessionResult.success || !sessionResult.data) {
    sendResponse({ res, status: 404, error: 'Research session not found', code: 'NOT_FOUND', logger, method: 'POST', path: '/research/sessions/:id/pages', duration: Date.now() - start });
    return;
  }

  const result = await createSessionPage(db, idCheck.id, title.trim());
  if (!result.success) {
    sendResponse({ res, status: mapErrorToStatus(result.code) || 500, error: result.error, code: result.code || 'DATABASE_ERROR', logger, method: 'POST', path: '/research/sessions/:id/pages', duration: Date.now() - start });
    return;
  }

  const stepResult = await getStep(db, result.data);
  if (!stepResult.success || !stepResult.data) {
    sendResponse({ res, status: 500, error: 'Created step could not be loaded', code: 'DATABASE_ERROR', logger, method: 'POST', path: '/research/sessions/:id/pages', duration: Date.now() - start });
    return;
  }

  sendResponse({ res, status: 201, data: toApiStepSummary(stepResult.data), logger, method: 'POST', path: '/research/sessions/:id/pages', duration: Date.now() - start });
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

router.put('/steps/:id', async (req, res) => {
  const start = Date.now();
  const idCheck = validateId({ req, res, paramName: 'id', logger, path: '/research/steps/:id', start });
  if (!idCheck.valid) return;

  const stepResult = await getStep(db, idCheck.id);
  if (!stepResult.success || !stepResult.data) {
    sendResponse({ res, status: 404, error: 'Research step not found', code: 'NOT_FOUND', logger, method: 'PUT', path: '/research/steps/:id', duration: Date.now() - start });
    return;
  }

  const step = stepResult.data;
  if (step.rstep_action_type !== 'curated_page') {
    sendResponse({ res, status: 400, error: 'Only curated_page steps can be updated via this route', code: 'VALIDATION_ERROR', logger, method: 'PUT', path: '/research/steps/:id', duration: Date.now() - start });
    return;
  }

  const { intent_text, canvas, synthesis, envelope } = req.body;
  const updateData = {};
  if (intent_text !== undefined) updateData.rstep_intent_text = intent_text;
  if (canvas !== undefined) updateData.rstep_canvas_state = canvas;
  if (synthesis !== undefined) updateData.rstep_synthesis = synthesis;
  if (envelope !== undefined) updateData.rstep_envelope = envelope;

  if (Object.keys(updateData).length === 0) {
    sendResponse({ res, status: 400, error: 'No fields to update', code: 'VALIDATION_ERROR', logger, method: 'PUT', path: '/research/steps/:id', duration: Date.now() - start });
    return;
  }

  const result = await updateCuratedPage(db, idCheck.id, updateData);
  if (!result.success) {
    sendResponse({ res, status: mapErrorToStatus(result.code) || 500, error: result.error, code: result.code || 'DATABASE_ERROR', logger, method: 'PUT', path: '/research/steps/:id', duration: Date.now() - start });
    return;
  }

  const updated = await getStep(db, idCheck.id);
  sendResponse({ res, status: 200, data: toApiStep(updated.data), logger, method: 'PUT', path: '/research/steps/:id', duration: Date.now() - start });
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
 * /research/graph:
 *   get:
 *     summary: Get the global entity graph for a server/bank
 *     description: Returns the normalized Hindsight entity graph for the selected server and bank, with architxt entity labels/types resolved.
 *     tags: [Research]
 *     parameters:
 *       - in: query
 *         name: server_id
 *         required: true
 *         schema:
 *           type: integer
 *       - in: query
 *         name: bank_id
 *         required: true
 *         schema:
 *           type: string
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
router.get('/graph', async (req, res) => {
  const start = Date.now();
  const serverId = parseInt(req.query.server_id, 10);
  const bankId = req.query.bank_id;
  const { limit, min_count } = req.query;

  if (!serverId || !bankId) {
    sendResponse({ res, status: 400, error: 'server_id and bank_id are required', code: 'VALIDATION_ERROR', logger, method: 'GET', path: '/research/graph', duration: Date.now() - start });
    return;
  }

  try {
    const result = await normalizeHindsightGraph(serverId, bankId, db, {
      limit: limit ? Number.parseInt(limit, 10) : 1000,
      min_count: min_count ? Number.parseInt(min_count, 10) : undefined,
    });
    if (!result.success) {
      sendResponse({ res, status: 502, error: result.error, code: result.code || 'GRAPH_FAILED', logger, method: 'GET', path: '/research/graph', duration: Date.now() - start });
      return;
    }
    sendResponse({ res, status: 200, data: { nodes: result.nodes, edges: result.edges }, logger, method: 'GET', path: '/research/graph', duration: Date.now() - start });
  } catch (err) {
    logger.error('Research graph route error', { serverId, bankId, error: err.message });
    sendResponse({ res, status: 500, error: err.message, code: 'INTERNAL_ERROR', logger, method: 'GET', path: '/research/graph', duration: Date.now() - start });
  }
});

/**
 * @openapi
 * /research/entities:
 *   get:
 *     summary: Get all entities for a server/bank
 *     description: Returns every Hindsight entity for the server and bank resolved to architxt canonical entities.
 *     tags: [Research]
 *     parameters:
 *       - in: query
 *         name: server_id
 *         required: true
 *         schema:
 *           type: integer
 *       - in: query
 *         name: bank_id
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Entity list
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
router.get('/entities', async (req, res) => {
  const start = Date.now();
  const serverId = parseInt(req.query.server_id, 10);
  const bankId = req.query.bank_id;

  if (!serverId || !bankId) {
    sendResponse({ res, status: 400, error: 'server_id and bank_id are required', code: 'VALIDATION_ERROR', logger, method: 'GET', path: '/research/entities', duration: Date.now() - start });
    return;
  }

  try {
    const result = await normalizeHindsightEntities(serverId, bankId, db, { limit: 1000 });
    if (!result.success) {
      sendResponse({ res, status: 502, error: result.error, code: result.code || 'ENTITIES_FAILED', logger, method: 'GET', path: '/research/entities', duration: Date.now() - start });
      return;
    }
    sendResponse({ res, status: 200, data: { nodes: result.nodes, edges: result.edges }, logger, method: 'GET', path: '/research/entities', duration: Date.now() - start });
  } catch (err) {
    logger.error('Research entities route error', { serverId, bankId, error: err.message });
    sendResponse({ res, status: 500, error: err.message, code: 'INTERNAL_ERROR', logger, method: 'GET', path: '/research/entities', duration: Date.now() - start });
  }
});

export default router;
