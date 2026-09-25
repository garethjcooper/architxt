import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import { ensureSchema } from '../src/db/ensure-schema.js';
import { clearCache } from '../src/cache.js';
import { createSession, createStep, updateStep } from '../src/db/crud/research.js';
import { createEntityType } from '../src/db/crud/entity-types.js';
import { createEntity } from '../src/db/crud/entities.js';
import { upsertNode } from '../src/db/crud/contextual-graph.js';
import { createThread } from '../src/db/crud/agent-chat.js';
import { sendChatMessage } from '../src/services/agent/chat-service.js';
import { buildNodeId } from '../src/services/contextual-graph/identity.js';

function createTestDb() {
  const file = path.join(process.cwd(), `tmp/test-agent-chat-service-${Date.now()}.db`);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const db = new Database(file);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  ensureSchema(db);
  db.prepare('INSERT INTO servers (svr_base_url, svr_name) VALUES (?, ?)').run('http://hindsight', 'test');
  const serverId = db.prepare('SELECT last_insert_rowid() AS id').get().id;
  return { db, file, serverId };
}

function cleanupTestDb(db, file) {
  db.close();
  fs.unlinkSync(file);
}

describe('agent chat service', () => {
  let db;
  let file;
  let serverId;
  let sessionId;
  let threadId;

  beforeEach(() => {
    if (db) cleanupTestDb(db, file);
    ({ db, file, serverId } = createTestDb());
    clearCache();

    const typeResult = createEntityType(db, {
      type_name: 'svc',
      description: 'Service entity type',
      case_match: 'insensitive',
      word_boundary_match: 'boundaries',
    });
    assert.equal(typeResult.success, true);
    const typeId = typeResult.data;

    const entityResult = createEntity(db, {
      type_id: typeId,
      entity_id: 'SVC-TEST-001',
      name: 'Test Service',
      description: 'A test service entity',
      aliases: [],
    });
    assert.equal(entityResult.success, true);

    const nodeId = buildNodeId({ canonicalId: 'SVC-TEST-001', typeLabel: 'svc' });
    const nodeResult = upsertNode(db, serverId, 'bank', nodeId, ['canonical', 'active'], {
      display_name: 'Test Service',
      provenance: {
        model_refs: [
          {
            role: 'sys_entity_summary',
            ext_id: 'svc-summary-001',
            name: 'Service Summary',
            scope: { node_id: nodeId },
          },
        ],
      },
    });
    assert.equal(nodeResult.success, true);

    const sessionResult = createSession(db, {
      rs_title: 'Agent chat session',
      rs_bank_id: 'bank',
      rs_viewpoint_ids: [],
      rs_server_id: serverId,
    });
    assert.equal(sessionResult.success, true);
    sessionId = sessionResult.data;

    const threadResult = createThread(db, { rs_id: sessionId, act_title: 'Chat 1' });
    assert.equal(threadResult.success, true);
    threadId = threadResult.data;
  });

  it('returns contextual data for resolved entities', async () => {
    const nodeId = buildNodeId({ canonicalId: 'SVC-TEST-001', typeLabel: 'svc' });

    const stepResult = createStep(db, {
      rs_id: sessionId,
      rstep_intent_text: 'Explore Test Service',
      rstep_raw_query: 'Explore Test Service',
      rstep_action_type: 'discover',
      rstep_status: 'completed',
    });
    assert.equal(stepResult.success, true);

    const updateStepResult = updateStep(db, stepResult.data, {
      rstep_envelope: {
        narratives: [{ id: 'n-1', narrative_name: 'Overview', narrative: `The Test Service (${nodeId}) provides core functionality.`, evidence: [] }],
        graph: {
          name: 'Test Service Graph',
          nodes: [{ id: nodeId, name: 'Test Service', type: 'service' }],
          edges: [],
        },
        tables: [],
        diagrams: [],
      },
    });
    assert.equal(updateStepResult.success, true);
    assert.equal(updateStepResult.data, true);

    const result = await sendChatMessage(db, sessionId, threadId, 'Tell me about Test Service');

    assert.equal(result.session_id, sessionId);
    assert.equal(result.thread_id, threadId);
    assert.ok(result.reply, 'expected reply in response');
    assert.equal(result.reply.role, 'agent');
    assert.ok(result.reply.contextual_items, 'expected reply.contextual_items');

    const entityId = nodeId;
    const item = result.reply.contextual_items.find(
      (i) => i.entity_id === entityId || i.ext_id === 'svc-summary-001' || i.name?.includes('Test Service'),
    );
    assert.ok(item, `expected contextual item referencing ${entityId}`);

    assert.ok(result.tool_log, 'expected tool_log in response');
    assert.ok(
      result.tool_log.tools.some((t) => t.tool === 'buildContextualItems' && t.status === 'success'),
      'expected a successful buildContextualItems tool log entry',
    );

    assert.ok(result.query_state, 'expected query_state in response');
    assert.equal(result.query_state.resolved_entities.length, 1, 'expected one resolved entity');
    const resolved = result.query_state.resolved_entities[0];
    assert.equal(resolved.entity_id, 'SVC-TEST-001');
    assert.equal(resolved.type_name, 'svc');
    assert.equal(resolved.canonical_reference, `[[Test Service (svc:SVC-TEST-001)]]`);
    assert.equal(resolved.name, 'Test Service');
    assert.equal(result.reply.context_snapshot, undefined); // recall is not available in test env; context_snapshot stays undefined
  });

  it('does not duplicate session envelopes after a step is deleted', async () => {
    const nodeId = buildNodeId({ canonicalId: 'SVC-TEST-001', typeLabel: 'svc' });

    const unrelatedStepResult = createStep(db, {
      rs_id: sessionId,
      rstep_intent_text: 'Unrelated exploration',
      rstep_raw_query: 'Unrelated exploration',
      rstep_action_type: 'discover',
      rstep_status: 'completed',
    });
    assert.equal(unrelatedStepResult.success, true);

    const relatedStepResult = createStep(db, {
      rs_id: sessionId,
      rstep_intent_text: 'Explore Test Service',
      rstep_raw_query: 'Explore Test Service',
      rstep_action_type: 'discover',
      rstep_status: 'completed',
    });
    assert.equal(relatedStepResult.success, true);

    await updateStep(db, relatedStepResult.data, {
      rstep_envelope: {
        narratives: [{ id: 'n-1', narrative_name: 'Overview', narrative: `The Test Service (${nodeId}) provides core functionality.`, evidence: [] }],
        graph: {
          name: 'Test Service Graph',
          nodes: [{ id: nodeId, name: 'Test Service', type: 'service' }],
          edges: [],
        },
        tables: [],
        diagrams: [],
      },
    });

    const firstResult = await sendChatMessage(db, sessionId, threadId, 'Tell me about Test Service');
    assert.equal(firstResult.query_state.resolved_entities.length, 1, 'expected only related session envelope');

    const { deleteStep } = await import('../src/db/crud/research.js');
    const deleteResult = deleteStep(db, relatedStepResult.data);
    assert.equal(deleteResult.success, true);

    const secondResult = await sendChatMessage(db, sessionId, threadId, 'Anything else?');
    assert.equal(secondResult.query_state.resolved_entities.length, 0, 'expected zero related resolved entities after deleting the related step');
  });

  it('merges contextual envelopes when multiple entities are resolved across turns', async () => {
    const nodeIdA = buildNodeId({ canonicalId: 'SVC-TEST-001', typeLabel: 'svc' });

    // Create a second entity type and entity.
    const typeResultB = createEntityType(db, {
      type_name: 'ext',
      description: 'External entity type',
      case_match: 'insensitive',
      word_boundary_match: 'boundaries',
    });
    assert.equal(typeResultB.success, true);
    const typeIdB = typeResultB.data;

    const entityResultB = createEntity(db, {
      type_id: typeIdB,
      entity_id: 'EXT-TEST-002',
      name: 'Test External',
      description: 'A test external entity',
      aliases: [],
    });
    assert.equal(entityResultB.success, true);

    const nodeIdB = buildNodeId({ canonicalId: 'EXT-TEST-002', typeLabel: 'ext' });
    const nodeResultB = upsertNode(db, serverId, 'bank', nodeIdB, ['canonical', 'active'], {
      display_name: 'Test External',
      provenance: {
        model_refs: [
          {
            role: 'sys_entity_summary',
            ext_id: 'ext-summary-002',
            name: 'External Summary',
            scope: { node_id: nodeIdB },
          },
        ],
      },
    });
    assert.equal(nodeResultB.success, true);

    // Also attach a contextual ref to the first entity's node.
    const nodeResultA = upsertNode(db, serverId, 'bank', nodeIdA, ['canonical', 'active'], {
      display_name: 'Test Service',
      provenance: {
        model_refs: [
          {
            role: 'sys_entity_summary',
            ext_id: 'svc-summary-001',
            name: 'Service Summary',
            scope: { node_id: nodeIdA },
          },
        ],
      },
    });
    assert.equal(nodeResultA.success, true);

    const firstResult = await sendChatMessage(db, sessionId, threadId, 'Tell me about Test Service');
    assert.equal(firstResult.query_state.resolved_entities.length, 1, 'expected one resolved entity after first message');
    assert.equal(firstResult.reply.contextual_items?.length, 1, 'expected one contextual item after first message');
    assert.equal(firstResult.reply.contextual_items[0].ext_id, 'svc-summary-001');
    assert.equal(firstResult.reply.contextual_items[0].name, 'Entity summary: Test Service');
    assert.equal(firstResult.reply.contextual_items[0].template_role, 'sys_entity_summary');

    const secondResult = await sendChatMessage(db, sessionId, threadId, 'Now tell me about Test External');
    assert.equal(secondResult.query_state.resolved_entities.length, 1, 'expected Test External resolved in second message');

    const allItemIds = [
      ...firstResult.reply.contextual_items.map((c) => c.ext_id),
      ...secondResult.reply.contextual_items.map((c) => c.ext_id),
    ].sort();
    const uniqueItemIds = [...new Set(allItemIds)];
    assert.equal(allItemIds.length, uniqueItemIds.length, 'expected no duplicate contextual items');

    const itemB = secondResult.reply.contextual_items.find((c) => c.ext_id === 'ext-summary-002' || c.name?.includes('Test External'));
    assert.ok(itemB, 'expected contextual item for Test External');
  });

  it('returns null contextual data when no entities are resolved', async () => {
    const result = await sendChatMessage(db, sessionId, threadId, 'Hello there');

    assert.equal(result.reply.contextual_items, undefined);
    assert.ok(
      !result.tool_log.tools.some((t) => t.tool === 'buildContextualItems'),
      'expected no buildContextualItems call when no entities resolved',
    );
  });

  it('advances query state on each plain message turn', async () => {
    const firstResult = await sendChatMessage(db, sessionId, threadId, 'Tell me about Test Service');
    assert.ok(firstResult.query_state, 'expected query_state after initial message');
    assert.ok(firstResult.query_state.created_at, 'expected query_state created_at');
    assert.equal(firstResult.query_state.resolved_entities.length, 1, 'expected one resolved entity');

    const secondResult = await sendChatMessage(db, sessionId, threadId, 'what systems interface with Test Service');
    assert.ok(secondResult.query_state, 'expected query_state on second turn');
    assert.ok(secondResult.query_state.created_at, 'expected query_state created_at on second turn');
    assert.equal(secondResult.query_state.resolved_entities.length, 1, 'expected one resolved entity');
  });
});
