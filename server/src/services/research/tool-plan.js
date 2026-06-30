/**
 * Research discovery agent tool plan.
 *
 * Each step makes a single Hindsight Reflect call with response_schema. The
 * schema asks for findings, seams, and a Markdown narrative together. The agent
 * no longer does per-topic planning or in-step synthesis.
 */

import { reflect } from '../hindsight/index.js';
import { createLogger } from '../../utils/logger.js';

const logger = createLogger('research-tool-plan');

const RESEARCH_RESPONSE_SCHEMA = {
  type: 'object',
  properties: {
    findings: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          statement: { type: 'string' },
          confidence: { type: 'number' },
          source_fact_ids: {
            type: 'array',
            items: { type: 'string' },
          },
        },
        required: ['statement'],
      },
    },
    seams: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          type: { type: 'string' },
          description: { type: 'string' },
          source_fact_ids: {
            type: 'array',
            items: { type: 'string' },
          },
        },
        required: ['description'],
      },
    },
    narrative: { type: 'string' },
  },
  required: ['findings', 'seams', 'narrative'],
};

/** Estimate token count from a text string using a rough 4-chars-per-token heuristic. */
function estimateTokens(text) {
  if (typeof text !== 'string') return 0;
  return Math.ceil(text.length / 4);
}

export function sizeOf(value) {
  try {
    return JSON.stringify(value).length;
  } catch {
    return String(value).length;
  }
}

function baseOptions(options) {
  const { budget = 'high', max_tokens, types, tags, tags_match } = options || {};
  return {
    budget,
    ...(max_tokens !== undefined && { max_tokens }),
    ...(types !== undefined && { types }),
    ...(tags !== undefined && { tags }),
    ...(tags_match !== undefined && { tags_match }),
  };
}

function formatSelectionReference(selection) {
  if (selection.kind !== 'entity') return selection.label || selection.id;
  if (selection.type) return `${selection.label || selection.id} (${selection.type}:${selection.id})`;
  return selection.label || selection.id;
}

function buildPrompt(intentText, selections, options) {
  const parts = [intentText];

  if (selections.length > 0) {
    parts.push(`Selected entities: ${selections.map(formatSelectionReference).join(', ')}`);
  }

  if (options?.types?.length) {
    parts.push(`Limit to types: ${options.types.join(', ')}`);
  }

  if (options?.tags?.length) {
    parts.push(`Filter by tags: ${options.tags.join(', ')}`);
  }

  return parts.join('\n\n');
}

function researchPrompt(intentText, selections, options) {
  const query = buildPrompt(intentText, selections, options);
  return `You are a research analysis assistant for a Hindsight Reflect query.

## Research question
${query}

## Output
Use the facts in the memory bank to produce a structured analysis. Return ONLY a JSON object with this exact shape (no Markdown, no commentary):
{
  "findings": [
    { "id": "finding-1", "statement": "...", "confidence": 0.85, "source_fact_ids": [] }
  ],
  "seams": [
    { "id": "seam-1", "type": "gap", "description": "...", "source_fact_ids": [] }
  ],
  "narrative": "A coherent Markdown narrative that weaves the findings together, resolves contradictions if possible, and highlights the most important seams."
}

A "finding" is a concise factual claim supported by the evidence. A "seam" is a gap, contradiction, ambiguity, or missing source. Confidence is 0.0–1.0.`;
}

export function makeResearchCall(intentText, selections = [], options = {}) {
  const prompt = researchPrompt(intentText, selections, options);
  const args = {
    ...baseOptions(options),
    query: prompt,
    mode: 'reflect',
    budget: options?.budget || 'mid',
    response_schema: RESEARCH_RESPONSE_SCHEMA,
  };

  return {
    name: 'research_reflect',
    metrics: {
      prompt_chars: prompt.length,
      prompt_tokens: estimateTokens(prompt),
    },
    args,
  };
}

/**
 * Execute a single research Reflect call.
 */
export async function executeCall(serverId, bankId, call) {
  return reflect(serverId, bankId, {
    query: call.args.query,
    budget: call.args.budget,
    response_schema: call.args.response_schema,
    ...(call.args.max_tokens !== undefined && { max_tokens: call.args.max_tokens }),
    ...(call.args.types !== undefined && { types: call.args.types }),
    ...(call.args.tags !== undefined && { tags: call.args.tags }),
    ...(call.args.tags_match !== undefined && { tags_match: call.args.tags_match }),
  });
}

/**
 * Normalize findings to the canonical contract shape.
 */
export function normalizeFindings(raw) {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((f, idx) => ({
      id: typeof f.id === 'string' ? f.id : `finding-${idx}`,
      statement: typeof f.statement === 'string' ? f.statement : '',
      confidence: typeof f.confidence === 'number' ? f.confidence : 0.75,
      source_fact_ids: Array.isArray(f.source_fact_ids) ? f.source_fact_ids : [],
    }))
    .filter((f) => f.statement);
}

/**
 * Normalize seams to the canonical contract shape.
 */
export function normalizeSeams(raw) {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((s, idx) => ({
      id: typeof s.id === 'string' ? s.id : `seam-${idx}`,
      type: typeof s.type === 'string' ? s.type : 'gap',
      description: typeof s.description === 'string' ? s.description : '',
      source_fact_ids: Array.isArray(s.source_fact_ids) ? s.source_fact_ids : [],
    }))
    .filter((s) => s.description);
}

/**
 * Parse a Hindsight Reflect response that used response_schema.
 *
 * Expected envelope:
 * {
 *   structured_output: { findings: [...], seams: [...], narrative: "..." },
 *   text: "...",
 *   ...
 * }
 */
export function parseResearchResponse(toolResult) {
  if (!toolResult.success) {
    return { success: false, error: toolResult.error, code: toolResult.code };
  }

  const data = toolResult.data;
  if (!data || typeof data !== 'object') {
    return {
      success: false,
      error: 'Reflect response was not an object',
      code: 'AGENT_INVALID_RESPONSE',
    };
  }

  const structured = data.structured_output;
  if (!structured || typeof structured !== 'object') {
    logger.warn('Reflect research response missing structured_output', {
      keys: Object.keys(data),
    });
    return {
      success: false,
      error: 'Reflect response missing structured_output',
      code: 'AGENT_INVALID_RESPONSE',
    };
  }

  return {
    success: true,
    findings: normalizeFindings(structured.findings),
    seams: normalizeSeams(structured.seams),
    narrative: typeof structured.narrative === 'string' ? structured.narrative : '',
  };
}

/**
 * @deprecated Use parseResearchResponse. Kept for backward compatibility during
 * the transition from separate synthesis calls.
 */
export function parseSynthesisResponse(toolResult, backend) {
  if (!toolResult.success) {
    return { success: false, error: toolResult.error, code: toolResult.code };
  }

  const data = toolResult.data;

  if (backend === 'reflect') {
    if (!data || typeof data !== 'object') {
      return {
        success: false,
        error: 'Reflect synthesis response was not an object',
        code: 'AGENT_INVALID_RESPONSE',
      };
    }
    const text = data.text;
    if (typeof text !== 'string' || text.length === 0) {
      logger.warn('Reflect synthesis response missing text', { keys: Object.keys(data) });
      return {
        success: false,
        error: 'Reflect synthesis response missing text',
        code: 'AGENT_INVALID_RESPONSE',
      };
    }
    return { success: true, narrative: text };
  }

  if (typeof data === 'string') {
    return { success: true, narrative: data };
  }

  if (data && typeof data === 'object' && typeof data.content === 'string') {
    return { success: true, narrative: data.content };
  }

  logger.warn('Synthesis response had unexpected shape', { backend, type: typeof data });
  return {
    success: false,
    error: 'Synthesis response was not a Markdown string',
    code: 'AGENT_INVALID_RESPONSE',
  };
}

/**
 * @deprecated Use parseResearchResponse.
 */
export function parseReflectFindingsResponse(toolResult) {
  return parseResearchResponse(toolResult);
}

export default {
  makeResearchCall,
  executeCall,
  normalizeFindings,
  normalizeSeams,
  parseResearchResponse,
  parseSynthesisResponse,
  parseReflectFindingsResponse,
};
