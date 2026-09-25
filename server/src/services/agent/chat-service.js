import * as agentChatCrud from '../../db/crud/agent-chat.js';
import * as researchCrud from '../../db/crud/research.js';
import { createLogger } from '../../utils/logger.js';
import { config } from '../../config.js';
import { resolveEntitiesFromText, toCanonicalEntityRefs, groupResolvedEntities } from './entity-resolver.js';
import { runRecallTool } from './research-tools.js';
import { buildMergedGraphForEntityRefs } from './graph-merge-tool.js';
import { buildEntityInfoMap } from '../entity-info.js';
import { generateCompletion } from '../llm/client.js';
import { randomUUID } from 'crypto';

const logger = createLogger('agent-chat-service');

function buildQueryState({ outputIntent, resolvedEntities }) {
  const grouped = groupResolvedEntities(resolvedEntities);
  return {
    intent: outputIntent || null,
    aql: outputIntent?.aql || null,
    resolved_entity_refs: grouped.map((e) => `[[${e.canonical_reference}]]`),
    resolved_entities: grouped,
    created_at: new Date().toISOString(),
  };
}

function formatDeterministicResponse(matches) {
  const entityNames = (matches || [])
    .map((e) => e.name || e.entity_id)
    .filter(Boolean);

  if (entityNames.length === 0) {
    return 'No entities detected.';
  }
  return `Entities detected (${entityNames.length}): ${entityNames.join(', ')}`;
}

/**
 * Build a deterministic AQL query from the classified output intent.
 *
 * Emits one block per selected focus using the canonical AQL block syntax.
 * Block bodies are the per-section queries. This is kept for later wiring;
 * it is not sent to the response yet.
 *
 * @param {Object} outputIntent
 * @returns {string}
 */
function buildAqlFromIntent(outputIntent) {
  if (!outputIntent || !Array.isArray(outputIntent.sections) || outputIntent.sections.length === 0) {
    return '';
  }

  const focusOrder = ['narrative', 'diagram', 'graph', 'table'];
  const ordered = outputIntent.sections.slice().sort((a, b) => {
    const ai = focusOrder.indexOf(a.focus);
    const bi = focusOrder.indexOf(b.focus);
    if (ai !== bi) return (ai === -1 ? 999 : ai) - (bi === -1 ? 999 : bi);
    return 0;
  });

  const lines = [];
  for (const section of ordered) {
    const focus = section.focus;
    const name = section.name;
    const query = section.query;
    if (!query) continue;

    lines.push(`#${focus}`);
    if (name) {
      lines.push(`#${focus}-name ${name}`);
    }
    if (focus === 'diagram' && section.diagram_type) {
      lines.push(`#diagram-type ${section.diagram_type}`);
    }
    lines.push(query);
    lines.push('#end');
    lines.push('');
  }

  return lines.join('\n').trim();
}

function buildSynthesisPrompt({ userMessage, entityScanText, recallDigest, resolvedEntityRefs, outputIntent }) {
  const intentDescription = outputIntent?.reason
    ? `Intent: ${outputIntent.reason}\nPlanned outputs: ${(outputIntent?.focus || []).join(', ')}`
    : `Planned outputs: ${(outputIntent?.focus || []).join(', ')}`;

  return [
    {
      role: 'system',
      content: `You are a senior IT Architect. Your purpose is to surface architectural components, interfaces and interactions in a concise, accurate and consistent way.

Always consider the following when formulating your response - but only return information relevant to the question:
1. COMPONENTS: A single system, service, database, or external integration. Use full entity labels [[entity name (entity canonical id)]] when present. Components by themselves (i.e. just being present) is NOT a fact.
2. DATA FLOWS:  which specific component produces data and which specific component consumes it. Use explicit language: sends to, receives from, exchanges with.
3. RISKS & CONSTRAINTS: performance limits, size limits, vendor gaps, or regulatory requirements.
5. SIZING: data volumes, collection sizes, or throughput figures.
6. SYSTEM PURPOSE & CAPABILITIES: What business or technical capability the system provides, what problem it solves in the architecture, and what role it plays (e.g., canonical source, integration hub, customer-facing portal, reporting layer, data warehouse).

OUTPUT RULES — obey these strictly:
- Write plain text only. Do not use markdown tables, lists, code blocks, or headings in the body of the summary.
- Render every fact as plain prose. You MUST NOT use any inline citations, bracketed references such as [1] or 【...】, footnotes, or any other source markers inside the prose.
- The only source references allowed anywhere in the response are entity references [[entity name (entity canonical id)]] and the final ## Sources section. Hindsight memory IDs must never appear inside the prose, not even wrapped in parentheses, dashes, or commas.
- Write sentences as normal English: "Singleview sends rated charging information to IME." Do not append memory IDs to sentences.
- At the very end of your response, add a single markdown section titled exactly \`## Sources\`.
- The Sources section must contain only the full, exact Hindsight memory IDs you used. Each ID must match the \`id=...\` value shown in the recalled memories. Use this format:\n\n## Sources\n- 123e4567-e89b-12d3-a456-426614174000\n- 98765432-10fe-dcba-9876-543210fedcba\n\n- Do not truncate, shorten, hash, abbreviate, or invent IDs. Do not list IDs that you did not use. If you used no recalled memories, include the Sources section with no items.
- Do not output anything else after the Sources section.

The recalled memories below are ordered by relevance but are not filtered. Only use facts that relate directly to the user's question; ignore off-topic memories even if they are included. Do not summarise memories that are not relevant to the question.`,
    },
    {
      role: 'user',
      content: `User message: ${userMessage}\n\n${intentDescription}\n\nResolved entities: ${resolvedEntityRefs.join(', ') || 'none'}\n\n${entityScanText}\n\nRecall digest:\n${recallDigest}\n\nWrite a concise summary that answers the user's question, followed by a Sources section as instructed.`,
    },
  ];
}

async function synthesizeRecall({ userMessage, entityScanText, recallResult, resolvedEntityRefs, outputIntent }) {
  const digest = recallResult?.success ? recallResult.data?.llm_digest || 'No recall results.' : `Recall unavailable: ${recallResult?.error || 'unknown'}`;
  const messages = buildSynthesisPrompt({ userMessage, entityScanText, recallDigest: digest, resolvedEntityRefs, outputIntent });
  const request = {
    provider: config.agent.provider,
    model: config.agent.model,
    temperature: config.agent.temperature ?? 0.2,
    max_tokens: 2048,
  };

  const result = await generateCompletion(messages, request);
  if (!result.success) {
    logger.warn('Recall synthesis failed', { error: result.error, code: result.code });
    return {
      narrative: `Recall results are available but could not be synthesized: ${result.error || 'LLM error'}`,
      usage: null,
    };
  }

  const content = result.data.content || '';
  const validMemoryIds = new Set(
    (recallResult?.success ? recallResult.data?.memories || [] : [])
      .map((m) => m.id)
      .filter(Boolean)
  );

  return {
    narrative: content || '(no synthesis returned)',
    evidence: extractSynthesisEvidence(content, validMemoryIds),
    usage: result.data.usage || null,
  };
}

/**
 * Parse the markdown Sources section from a synthesis response.
 * Accepts formats like:
 *   ## Sources
 *   - 123e4567-e89b-12d3-a456-426614174000
 *   - 98765432-10fe-dcba-9876-543210fedcba
 * @param {string} text
 * @param {Set<string>} validIds - Set of memory IDs returned by recall; only real IDs are kept.
 * @returns {string[]}
 */
function extractSynthesisEvidence(text, validIds = new Set()) {
  if (!text) return [];
  const match = text.match(/##\s*Sources\s*\n([\s\S]*?)(?=\n##|\n\n\n|$)/i);
  if (!match) return [];
  const section = match[1];
  const candidates = [];

  const bulletRe = /^[-*]\s*(.+)$/gm;
  let m;
  while ((m = bulletRe.exec(section)) !== null) {
    const line = m[1].trim();
    if (!line) continue;
    const candidate = line.split(/[\s,]+/)[0].replace(/[.,;:$)]+$/g, '');
    if (candidate) candidates.push(candidate);
  }

  return [...new Set(candidates)].filter((id) => validIds.has(id));
}

/**
 * Remove the markdown Sources section from synthesis prose so the narrative
 * is clean when placed in the envelope.
 * @param {string} text
 * @returns {string}
 */
function stripSourcesSection(text) {
  if (!text) return '';
  return text.replace(/\n?##\s*Sources\s*\n[\s\S]*?(?=\n##|\n\n\n|$)/i, '').trim();
}

function buildChatEnvelope({ synthesisText, evidence, mergedGraph }) {
  const narrative = stripSourcesSection(synthesisText);
  const narrativeName = narrative ? 'Agent response' : 'No response';
  return {
    narratives: [{
      id: randomUUID(),
      narrative_name: narrativeName,
      narrative,
      evidence: Array.isArray(evidence) ? evidence : [],
    }],
    graph: mergedGraph || { name: '', nodes: [], edges: [] },
    tables: [],
    diagrams: [],
  };
}

function toApiChatMessage(row) {
  const toolLog = row.acm_tool_log || {};
  return {
    acm_id: row.acm_id,
    act_id: row.act_id,
    rs_id: row.rs_id,
    role: row.acm_role,
    content: row.acm_content,
    model: row.acm_model ?? undefined,
    usage: row.acm_usage ?? undefined,
    evidence: Array.isArray(toolLog.synthesis_evidence) ? toolLog.synthesis_evidence : undefined,
    envelope: row.acm_envelope || undefined,
    contextual_items: row.acm_contextual_items || undefined,
    acm_created_at: row.acm_created_at,
    acm_updated_at: row.acm_updated_at,
  };
}

function toApiThread(row, messageCount = 0) {
  return {
    act_id: row.act_id,
    rs_id: row.rs_id,
    title: row.act_title,
    message_count: messageCount,
    act_created_at: row.act_created_at,
    act_updated_at: row.acm_updated_at,
  };
}

function generateNewChatName(threads) {
  const base = 'Chat';
  let index = 1;
  const existing = new Set(threads.map((t) => t.act_title));
  while (existing.has(`${base} ${index}`)) {
    index++;
  }
  return `${base} ${index}`;
}

async function resolvePromptEntities(db, text) {
  return resolveEntitiesFromText(db, text);
}

/**
 * Build a flat list of contextual/session items for a set of entity refs using
 * the actual contextual graph data via buildEntityInfoMap. This is a separate
 * read-only aggregation from the edge-context graph merge.
 *
 * @param {Object} db
 * @param {number} serverId
 * @param {string} bankId
 * @param {string[]} entityRefs
 * @returns {Promise<{ success: boolean, items?: object[], error?: string, code?: string }>}
 */
async function buildContextualItemsForEntities(db, serverId, bankId, entityRefs) {
  if (!serverId || !bankId || !entityRefs.length) {
    return { success: true, items: [] };
  }

  const infoResult = await buildEntityInfoMap(db, serverId, bankId, entityRefs, { includeContent: false });
  if (!infoResult.success) {
    return { success: false, error: infoResult.error, code: infoResult.code || 'ENTITY_INFO_FAILED' };
  }

  const entities = infoResult.data?.entities || {};
  const items = [];

  for (const entityId of Object.keys(entities)) {
    const info = entities[entityId];

    for (const ref of info.contextual_refs || []) {
      const scope = ref.scope || {};
      items.push({
        ext_id: ref.ext_id,
        name: ref.name || ref.ext_id,
        role: ref.role,
        template_role: ref.role,
        kind: 'contextual_ref',
        entity_id: scope.node_id || scope.seed_id || entityId,
        source_id: scope.source_id || null,
        target_id: scope.target_id || null,
      });
    }

    for (const m of info.derived_models || []) {
      items.push({
        ext_id: m.ext_id,
        name: m.name || m.ext_id,
        role: m.template_role || 'user_entity_derived',
        template_role: m.template_role,
        kind: 'derived_model',
        entity_id: entityId,
        source_id: null,
        target_id: null,
      });
    }

    for (const m of info.plain_models || []) {
      items.push({
        ext_id: m.ext_id,
        name: m.name || m.ext_id,
        role: m.template_role || 'mental_model',
        template_role: m.template_role,
        kind: 'plain_model',
        entity_id: entityId,
        source_id: null,
        target_id: null,
      });
    }

    const allowedEntityIds = new Set(entityRefs);

    for (const ctx of info.edge_contexts || []) {
      for (const ref of ctx.refs || []) {
        const sourceId = ctx.source_id || ref.scope?.source_id || null;
        const targetId = ctx.target_id || ref.scope?.target_id || null;
        // Only include edge-context items where both endpoints are in the
        // extracted entity list. This prevents unrelated neighbour entities
        // from expanding the contextual-data set.
        if (sourceId && targetId && (!allowedEntityIds.has(sourceId) || !allowedEntityIds.has(targetId))) {
          continue;
        }
        items.push({
          ext_id: ref.ext_id,
          name: ref.name || ref.ext_id,
          role: ref.role,
          template_role: ref.role,
          kind: 'edge_context',
          entity_id: entityId,
          source_id: sourceId,
          target_id: targetId,
        });
      }
    }
  }

  // De-duplicate by ext_id + source + target + kind.
  const seen = new Set();
  const deduped = [];
  for (const item of items) {
    const key = `${item.kind}|${item.ext_id}|${item.source_id || ''}|${item.target_id || ''}|${item.entity_id || ''}`;
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(item);
  }

  logger.info('Built contextual items for chat', {
    serverId,
    bankId,
    entityCount: entityRefs.length,
    itemCount: deduped.length,
  });

  return { success: true, items: deduped };
}

/**
 * List chat threads for a session.
 * @param {Object} db
 * @param {number} sessionId
 */
export async function listChatThreads(db, sessionId) {
  const threadsResult = await agentChatCrud.listThreadsForSession(db, sessionId);
  if (!threadsResult.success) {
    throw new Error(threadsResult.error || 'Failed to load chat threads');
  }
  const rows = threadsResult.data;
  const counts = await Promise.all(
    rows.map(async (t) => {
      const r = await agentChatCrud.countMessagesForThread(db, t.act_id);
      return r.success ? r.data : 0;
    })
  );
  return {
    threads: rows.map((t, i) => toApiThread(t, counts[i])),
    provider: config.agent.provider,
    model: config.agent.model,
  };
}

/**
 * Create a new chat thread.
 * @param {Object} db
 * @param {number} sessionId
 * @param {string} [title]
 */
export async function createChatThread(db, sessionId, title) {
  const sessionResult = await researchCrud.getSession(db, sessionId);
  if (!sessionResult.success || !sessionResult.data) {
    throw Object.assign(new Error('Research session not found'), { code: 'SESSION_NOT_FOUND' });
  }

  const threadsResult = await agentChatCrud.listThreadsForSession(db, sessionId);
  const threads = threadsResult.success ? threadsResult.data : [];
  const nextTitle = title?.trim() || generateNewChatName(threads);

  const threadResult = await agentChatCrud.createThread(db, {
    rs_id: sessionId,
    act_title: nextTitle,
  });
  if (!threadResult.success) {
    throw new Error(threadResult.error || 'Failed to create chat thread');
  }

  const threadRow = await agentChatCrud.getThread(db, threadResult.data);
  return toApiThread(threadRow.success ? threadRow.data : { act_id: threadResult.data, rs_id: sessionId, act_title: nextTitle }, 0);
}

/**
 * Rename a chat thread.
 * @param {Object} db
 * @param {number} sessionId
 * @param {number} threadId
 * @param {string} title
 */
export async function renameChatThread(db, sessionId, threadId, title) {
  const threadResult = await agentChatCrud.getThread(db, threadId);
  if (!threadResult.success || !threadResult.data) {
    throw Object.assign(new Error('Chat thread not found'), { code: 'NOT_FOUND' });
  }
  if (threadResult.data.rs_id !== sessionId) {
    throw Object.assign(new Error('Chat thread does not belong to session'), { code: 'FORBIDDEN' });
  }
  const nextTitle = title?.trim();
  if (!nextTitle) {
    throw Object.assign(new Error('title is required'), { code: 'VALIDATION_ERROR' });
  }
  await agentChatCrud.updateThread(db, threadId, { act_title: nextTitle });
  const updated = await agentChatCrud.getThread(db, threadId);
  const countResult = await agentChatCrud.countMessagesForThread(db, threadId);
  return toApiThread(updated.success ? updated.data : threadResult.data, countResult.success ? countResult.data : 0);
}

/**
 * Delete a chat thread and all its messages.
 * @param {Object} db
 * @param {number} sessionId
 * @param {number} threadId
 */
export async function deleteChatThread(db, sessionId, threadId) {
  const threadResult = await agentChatCrud.getThread(db, threadId);
  if (!threadResult.success || !threadResult.data) {
    throw Object.assign(new Error('Chat thread not found'), { code: 'NOT_FOUND' });
  }
  if (threadResult.data.rs_id !== sessionId) {
    throw Object.assign(new Error('Chat thread does not belong to session'), { code: 'FORBIDDEN' });
  }
  const deleted = await agentChatCrud.deleteThread(db, threadId);
  if (!deleted.success) {
    throw new Error(deleted.error || 'Failed to delete chat thread');
  }
  return { success: true, deleted: deleted.data > 0 };
}

/**
 * Get chat history for a thread.
 * @param {Object} db
 * @param {number} sessionId
 * @param {number} threadId
 */
export async function getChatHistory(db, sessionId, threadId) {
  const threadResult = await agentChatCrud.getThread(db, threadId);
  if (!threadResult.success || !threadResult.data) {
    throw Object.assign(new Error('Chat thread not found'), { code: 'NOT_FOUND' });
  }
  if (threadResult.data.rs_id !== sessionId) {
    throw Object.assign(new Error('Chat thread does not belong to session'), { code: 'FORBIDDEN' });
  }

  const messagesResult = await agentChatCrud.listMessagesForThread(db, threadId);
  if (!messagesResult.success) {
    throw new Error(messagesResult.error || 'Failed to load chat messages');
  }

  const sessionResult = await researchCrud.getSession(db, sessionId);
  const session = sessionResult.success ? sessionResult.data : null;

  return {
    thread: toApiThread(threadResult.data, messagesResult.data.length),
    messages: messagesResult.data.map(toApiChatMessage),
    provider: config.agent.provider,
    model: config.agent.model,
    server_id: session?.rs_server_id ?? null,
    bank_id: session?.rs_bank_id ?? null,
  };
}

/**
 * Send a message in a chat thread and return the agent's reply.
 *
 * @param {Object} db
 * @param {number} sessionId
 * @param {number} threadId
 * @param {string} userMessage
 */
export async function sendChatMessage(db, sessionId, threadId, userMessage) {
  if (!userMessage || typeof userMessage !== 'string' || userMessage.trim().length === 0) {
    throw Object.assign(new Error('message is required and must be a non-empty string'), { code: 'MISSING_MESSAGE' });
  }

  const threadResult = await agentChatCrud.getThread(db, threadId);
  if (!threadResult.success || !threadResult.data) {
    throw Object.assign(new Error('Chat thread not found'), { code: 'NOT_FOUND' });
  }
  if (threadResult.data.rs_id !== sessionId) {
    throw Object.assign(new Error('Chat thread does not belong to session'), { code: 'FORBIDDEN' });
  }

  const sessionResult = await researchCrud.getSession(db, sessionId);
  if (!sessionResult.success || !sessionResult.data) {
    throw Object.assign(new Error('Research session not found'), { code: 'SESSION_NOT_FOUND' });
  }
  const session = sessionResult.data;

  // Persist the user message.
  const userMessageResult = await agentChatCrud.createMessage(db, {
    act_id: threadId,
    rs_id: sessionId,
    acm_role: 'user',
    acm_content: userMessage.trim(),
  });
  if (!userMessageResult.success) {
    throw new Error(userMessageResult.error || 'Failed to persist user message');
  }
  const userMessageId = userMessageResult.data;

  let agentReply = null;
  let resolvedEntities = null;
  let outputIntent = null;
  let queryState = null;
  let synthesis = null;
  let recallResult = null;
  let mergedGraph = null;
  let agentEnvelope = null;
  const effectiveText = userMessage.trim();
  const toolLog = { tools: [] };

  let synthesisEntities = null;
  let synthesisEntityRefs = [];
  let contextualItems = null;

  try {
    resolvedEntities = await resolvePromptEntities(db, effectiveText);
    const resolvedEntityRefs = toCanonicalEntityRefs(resolvedEntities?.data);
    const resolvedEntityBracketedRefs = resolvedEntityRefs.map((ref) => `[[${ref}]]`);

    const entityScanText = formatDeterministicResponse(resolvedEntities?.data || []);
    agentReply = {
      content: entityScanText,
      model: 'deterministic-entity-scan',
      usage: null,
    };

    // Run recall when the session is backed by a Hindsight bank.
    if (session.rs_server_id && session.rs_bank_id) {
      const recallQuery = resolvedEntityBracketedRefs.length
        ? `${effectiveText}\n\nEntities: ${resolvedEntityBracketedRefs.join(', ')}`
        : effectiveText;
      recallResult = await runRecallTool(db, session.rs_server_id, session.rs_bank_id, recallQuery, {
        budget: 'high',
        max_tokens: 4096,
        prefer_observations: true,
        types: ['world', 'observation'],
        include: { entities: { max_tokens: 500 } },
      });

      toolLog.tools.push({
        tool: 'recall',
        status: recallResult.success ? 'success' : 'failure',
        request: { query: recallQuery, types: ['world', 'observation'], budget: 'high' },
        summary: recallResult.success
          ? { memory_count: recallResult.data?.count ?? 0, query: recallResult.data?.query }
          : { error: recallResult.error },
      });

      if (recallResult.success) {
        synthesis = await synthesizeRecall({
          userMessage: effectiveText,
          entityScanText,
          recallResult,
          resolvedEntityRefs: resolvedEntityBracketedRefs,
          outputIntent,
        });

        if (synthesis.narrative) {
          agentReply.content = stripSourcesSection(synthesis.narrative);
          agentReply.model = config.agent.model || 'synthesis';
          agentReply.usage = synthesis.usage;
          if (synthesis.evidence?.length) {
            toolLog.synthesis_evidence = synthesis.evidence;
          }
        }

        toolLog.tools.push({
          tool: 'synthesizeRecall',
          status: 'success',
          summary: { narrative_length: synthesis.narrative?.length },
          usage: synthesis.usage,
        });

        synthesisEntities = await resolvePromptEntities(db, synthesis.narrative || '');
        synthesisEntityRefs = toCanonicalEntityRefs(synthesisEntities?.data);
        const combinedEntityRefs = [...new Set([...resolvedEntityRefs, ...synthesisEntityRefs])];

        if (combinedEntityRefs.length > 0) {
          const [graphResult, contextualResult] = await Promise.all([
            buildMergedGraphForEntityRefs(
              db,
              session.rs_server_id,
              session.rs_bank_id,
              combinedEntityRefs,
            ),
            buildContextualItemsForEntities(
              db,
              session.rs_server_id,
              session.rs_bank_id,
              combinedEntityRefs,
            ),
          ]);

          if (graphResult.success && graphResult.data?.graph) {
            mergedGraph = graphResult.data.graph;
          }

          if (contextualResult.success && contextualResult.items?.length > 0) {
            contextualItems = contextualResult.items;
          }

          agentEnvelope = buildChatEnvelope({
            synthesisText: synthesis.narrative,
            evidence: synthesis.evidence,
            mergedGraph,
          });

          toolLog.tools.push({
            tool: 'mergeEdgeContextGraph',
            status: graphResult.success ? 'success' : 'failure',
            summary: graphResult.success
              ? {
                  resolved_entity_count: resolvedEntityRefs.length,
                  resolved_entity_refs: resolvedEntityRefs,
                  synthesis_entity_count: synthesisEntityRefs.length,
                  synthesis_entity_refs: synthesisEntityRefs,
                  combined_entity_count: combinedEntityRefs.length,
                  combined_entity_refs: combinedEntityRefs,
                  node_count: graphResult.data?.graph?.nodes?.length,
                  edge_count: graphResult.data?.graph?.edges?.length,
                  evidence_count: graphResult.data?.evidence?.length,
                }
              : { error: graphResult.error },
          });

          toolLog.tools.push({
            tool: 'buildContextualItems',
            status: contextualResult.success ? 'success' : 'failure',
            summary: contextualResult.success
              ? { item_count: contextualResult.items?.length ?? 0 }
              : { error: contextualResult.error },
          });
        }
      }
    }

    const combinedEntityMatches = [
      ...(resolvedEntities?.data || []),
      ...(synthesisEntities?.data || []),
    ];
    const combinedEntityRefs = [...new Set([
      ...toCanonicalEntityRefs(resolvedEntities?.data),
      ...toCanonicalEntityRefs(synthesisEntities?.data),
    ])];

    // Build contextual items from the local graph for every resolved entity.
    // This does not depend on recall/synthesis success, so the chat panel still
    // shows grounded context when Hindsight is temporarily unreachable.
    if (session.rs_server_id && session.rs_bank_id && combinedEntityRefs.length > 0) {
      const contextualResult = await buildContextualItemsForEntities(
        db,
        session.rs_server_id,
        session.rs_bank_id,
        combinedEntityRefs,
      );

      if (contextualResult.success && contextualResult.items?.length > 0) {
        contextualItems = contextualResult.items;
      }

      toolLog.tools.push({
        tool: 'buildContextualItems',
        status: contextualResult.success ? 'success' : 'failure',
        summary: contextualResult.success
          ? { item_count: contextualResult.items?.length ?? 0 }
          : { error: contextualResult.error },
      });
    }

    queryState = buildQueryState({ outputIntent, resolvedEntities: combinedEntityMatches });
    if (contextualItems) {
      queryState.contextual_items = contextualItems;
    }
  } catch (err) {
    logger.error('Agent chat request failed', { sessionId, threadId, error: err.message, code: err.code });

    const fallbackContent = `Sorry, I couldn't reach the agent: ${err.message}`;

    const fallbackResult = await agentChatCrud.createMessage(db, {
      act_id: threadId,
      rs_id: sessionId,
      acm_role: 'agent',
      acm_content: fallbackContent,
    });
    if (!fallbackResult.success) {
      logger.error('Failed to persist agent failure message', { sessionId, threadId, error: fallbackResult.error });
    }
    throw err;
  }

  const agentMessageResult = await agentChatCrud.createMessage(db, {
    act_id: threadId,
    rs_id: sessionId,
    acm_role: 'agent',
    acm_content: agentReply.content,
    acm_model: agentReply.model,
    acm_usage: agentReply.usage,
    acm_tool_log: toolLog,
    acm_envelope: agentEnvelope,
    acm_contextual_items: contextualItems,
  });
  if (!agentMessageResult.success) {
    throw new Error(agentMessageResult.error || 'Failed to persist agent message');
  }
  const agentMessageId = agentMessageResult.data;

  const agentRowResult = await agentChatCrud.getMessage(db, agentMessageId);
  const agentRow = agentRowResult.success ? agentRowResult.data : null;

  return {
    session_id: sessionId,
    thread_id: threadId,
    user_message_id: userMessageId,
    agent_message_id: agentMessageId,
    reply: toApiChatMessage(agentRow),
    tool_log: toolLog,
    query_state: queryState,
    envelope: agentEnvelope,
    server_id: session.rs_server_id ?? null,
    bank_id: session.rs_bank_id ?? null,
  };
}

/**
 * Delete a single chat message by id.
 * @param {Object} db
 * @param {number} sessionId
 * @param {number} threadId
 * @param {number} messageId
 */
export async function deleteChatMessage(db, sessionId, threadId, messageId) {
  const threadResult = await agentChatCrud.getThread(db, threadId);
  if (!threadResult.success || !threadResult.data) {
    throw Object.assign(new Error('Chat thread not found'), { code: 'NOT_FOUND' });
  }
  if (threadResult.data.rs_id !== sessionId) {
    throw Object.assign(new Error('Chat thread does not belong to session'), { code: 'FORBIDDEN' });
  }

  const msgResult = await agentChatCrud.getMessage(db, messageId);
  if (!msgResult.success || !msgResult.data) {
    throw Object.assign(new Error('Chat message not found'), { code: 'NOT_FOUND' });
  }
  if (msgResult.data.act_id !== threadId) {
    throw Object.assign(new Error('Chat message does not belong to thread'), { code: 'FORBIDDEN' });
  }
  const delResult = await agentChatCrud.deleteMessage(db, messageId);
  if (!delResult.success) {
    throw new Error(delResult.error || 'Failed to delete chat message');
  }
  return { success: true, deleted: delResult.data > 0 };
}

/**
 * Delete all chat messages for a thread.
 * @param {Object} db
 * @param {number} sessionId
 * @param {number} threadId
 */
export async function clearChatHistory(db, sessionId, threadId) {
  const threadResult = await agentChatCrud.getThread(db, threadId);
  if (!threadResult.success || !threadResult.data) {
    throw Object.assign(new Error('Chat thread not found'), { code: 'NOT_FOUND' });
  }
  if (threadResult.data.rs_id !== sessionId) {
    throw Object.assign(new Error('Chat thread does not belong to session'), { code: 'FORBIDDEN' });
  }
  const count = await agentChatCrud.deleteMessagesForThread(db, threadId);
  if (!count.success) {
    throw new Error(count.error || 'Failed to clear chat history');
  }
  return { success: true, deleted: count.data };
}

export default {
  listChatThreads,
  createChatThread,
  renameChatThread,
  deleteChatThread,
  getChatHistory,
  sendChatMessage,
  deleteChatMessage,
  clearChatHistory,
};
