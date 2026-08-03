import assert from 'node:assert/strict';
import { describe, it, beforeEach } from 'node:test';
import Database from 'better-sqlite3';
import { addContext } from '../src/services/contextual-graph/add-context.js';
import { ensureSchema } from '../src/db/ensure-schema.js';
import { clearCache } from '../src/cache.js';
import { runDiscovery } from '../src/services/contextual-graph/discovery.js';

const serverId = 1;
const bankId = 'Mozart-API';

function makeDb() {
  clearCache();
  const db = new Database(':memory:');
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  ensureSchema(db);
  return db;
}

function seedServer(db) {
  db.prepare('INSERT INTO servers (svr_name, svr_base_url) VALUES (?, ?)').run('Test', 'http://hindsight');
  return db.prepare('SELECT svr_id FROM servers').get().svr_id;
}

function seedEntities(db, rows) {
  for (const { type, entityId, name } of rows) {
    const typeRow = db.prepare('SELECT et_id FROM entity_types WHERE et_type_name = ?').get(type);
    const etId = typeRow ? typeRow.et_id : db.prepare('INSERT INTO entity_types (et_type_name, et_case_match) VALUES (?, ?)').run(type, 'insensitive').lastInsertRowid;
    db.prepare('INSERT OR IGNORE INTO entities (ent_type_id, ent_entity_id, ent_name) VALUES (?, ?, ?)').run(etId, entityId, name);
  }
}

function makeFetchGraph({ nodes = [], edges = [] }) {
  return async () => ({ success: true, data: { nodes, edges } });
}

describe('contextual-graph discovery runner', () => {
  let db;
  let svrId;

  beforeEach(() => {
    db = makeDb();
    svrId = seedServer(db);
    seedEntities(db, [
      { type: 'svc', entityId: 'SVC-005', name: 'Billing Service' },
      { type: 'svc', entityId: 'SVC-006', name: 'Payment Service' },
    ]);
  });

  it('returns candidates from mocked LLM response', async () => {
    const generateCompletion = async () => ({
      success: true,
      data: {
        content: JSON.stringify({
          candidates: [
            {
              id: 'invoice-gateway',
              summary: 'Invoice processing gateway',
              hypothesized_edges: [
                { target: 'svc:SVC-005', type: 'depends-on', evidence: 'mem-001' },
              ],
            },
          ],
        }),
      },
    });

    const spec = {
      ext_id: 'discover-svc:SVC-005',
      seedId: 'svc:SVC-005',
      source_query: 'Seed entity: svc:SVC-005 (Billing Service). Suggest new candidate nodes and hypothesized edges.',
      neighbor_ids: ['svc:SVC-006'],
    };

    const existingNodes = [
      {
        cgn_id: 'svc:SVC-005',
        cgn_labels: ['canonical', 'active', 'svc'],
        cgn_properties: { display_name: 'Billing Service' },
      },
      {
        cgn_id: 'svc:SVC-006',
        cgn_labels: ['canonical', 'active', 'svc'],
        cgn_properties: { display_name: 'Payment Service' },
      },
    ];

    const existingEdges = [
      {
        cge_id: 'hindsight:svc:SVC-005|svc:SVC-006',
        cge_source_id: 'svc:SVC-005',
        cge_target_id: 'svc:SVC-006',
        cge_type: null,
        cge_properties: { directed: false, weight: 1 },
      },
    ];

    const result = await runDiscovery(db, svrId, bankId, spec, {
      existingNodes,
      existingEdges,
      generateCompletion,
    });

    assert.equal(result.success, true);
    assert.equal(result.candidates.length, 1);
    assert.equal(result.candidates[0].id, 'invoice-gateway');
    assert.equal(result.candidates[0].displayName, 'Invoice processing gateway');
    assert.deepEqual(result.candidates[0].hypothesizedEdges, [
      { target: 'svc:SVC-005', type: 'depends-on', evidence: 'mem-001' },
    ]);
  });

  it('returns parse error for non-JSON LLM response', async () => {
    const generateCompletion = async () => ({
      success: true,
      data: { content: 'this is not json' },
    });

    const spec = {
      ext_id: 'discover-svc:SVC-005',
      seedId: 'svc:SVC-005',
      source_query: 'Seed entity: svc:SVC-005 (Billing Service).',
      neighbor_ids: [],
    };

    const result = await runDiscovery(db, svrId, bankId, spec, {
      existingNodes: [],
      existingEdges: [],
      generateCompletion,
    });

    assert.equal(result.success, false);
    assert.equal(result.code, 'PARSE_FAILED');
  });

  it('surfaces LLM errors', async () => {
    const generateCompletion = async () => ({
      success: false,
      error: 'timeout',
      code: 'LLM_TIMEOUT',
    });

    const spec = {
      ext_id: 'discover-svc:SVC-005',
      seedId: 'svc:SVC-005',
      source_query: 'Seed entity: svc:SVC-005 (Billing Service).',
      neighbor_ids: [],
    };

    const result = await runDiscovery(db, svrId, bankId, spec, {
      existingNodes: [],
      existingEdges: [],
      generateCompletion,
    });

    assert.equal(result.success, false);
    assert.equal(result.code, 'LLM_TIMEOUT');
  });

  it('integrates default discovery into addContext when run_discovery is true', async () => {
    const fetchGraph = makeFetchGraph({
      nodes: [
        { data: { id: 'h1', label: 'svc:SVC-005' } },
        { data: { id: 'h2', label: 'svc:SVC-006' } },
      ],
      edges: [{ data: { source: 'h1', target: 'h2', weight: 1 } }],
    });

    const calls = [];
    const generateCompletion = async (_messages, options) => {
      calls.push(options?.model);
      return {
        success: true,
        data: {
          content: JSON.stringify({
            candidates: [
              {
                id: 'invoice-gateway',
                summary: 'Invoice processing gateway',
                hypothesized_edges: [
                  { target: 'svc:SVC-005', type: 'depends-on', evidence: 'mem-001' },
                ],
              },
            ],
          }),
        },
      };
    };

    const result = await addContext(db, svrId, bankId, {
      fetchGraph,
      generateCompletion,
      deployBatch: async (_db, _serverId, _bankId, specs) => ({
        success: true,
        deployed: specs.map((s) => s.ext_id),
        failed: [],
      }),
      neighborhood: { run_discovery: true, top_k_neighbors: 5 },
    });

    assert.equal(result.success, true);
    // 2 canonical entity-ctx + 1 candidate entity-ctx
    assert.equal(result.queued.entity, 3, 'expected entity count: ' + result.queued.entity);
    // 1 canonical undirected edge-ctx + 1 candidate edge-ctx
    assert.equal(result.queued.edge, 1, 'expected edge count: ' + result.queued.edge);
    assert.equal(result.queued.discover, 2, 'expected discover count: ' + result.queued.discover);
    assert.ok(result.deployed.includes('discover-svc:SVC-005') && result.deployed.includes('discover-svc:SVC-006'));
  });
});
