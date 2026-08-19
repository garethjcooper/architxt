import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import express from 'express';
import Database from 'better-sqlite3';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ensureSchema } from '../src/db/ensure-schema.js';
import { clearCache } from '../src/cache.js';
import entitiesRouter from '../src/routes/entities.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

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
  return Number(db.prepare('SELECT svr_id FROM servers').get().svr_id);
}

function seedEntityType(db, name, prefix) {
  const result = db.prepare(`
    INSERT INTO entity_types (et_type_name, et_id_label, et_name_label, et_id_format_prefix, et_min_id_digits, et_id_separator)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(name, 'ID', 'Name', prefix, 3, 'dash');
  return Number(result.lastInsertRowid);
}

function seedEntity(db, typeId, entityId, name) {
  const result = db.prepare(`
    INSERT INTO entities (ent_type_id, ent_entity_id, ent_name, ent_description, ent_aliases, ent_generated_by)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(typeId, entityId, name, `${name} description`, JSON.stringify([]), 'user');
  return Number(result.lastInsertRowid);
}

function seedGraphNode(db, serverId, bankId, id, labels, properties) {
  db.prepare(`
    INSERT INTO contextual_graph_nodes (cgn_id, cgn_server_id, cgn_bank_id, cgn_labels, cgn_properties)
    VALUES (?, ?, ?, ?, ?)
  `).run(id, serverId, bankId, JSON.stringify(labels), JSON.stringify(properties));
}

function seedGraphEdge(db, serverId, bankId, id, sourceId, targetId, type, properties) {
  db.prepare(`
    INSERT INTO contextual_graph_edges (cge_id, cge_server_id, cge_bank_id, cge_source_id, cge_target_id, cge_type, cge_properties)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(id, serverId, bankId, sourceId, targetId, type, JSON.stringify(properties));
}

function seedMentalModel(db, data) {
  const result = db.prepare(`
    INSERT INTO mental_models (
      mm_ext_id, mm_name, mm_source_query, mm_is_template, mm_template_role,
      mm_dimension, mm_returns, mm_refresh_mode, mm_refresh_after_consolidation,
      mm_exclude_all_mental_models, mm_max_tokens, mm_tags_match_mode
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    data.ext_id,
    data.name,
    data.source_query ?? `Query ${data.name}`,
    data.is_template ? 'true' : 'false',
    data.template_role || null,
    data.dimension || null,
    data.returns || null,
    data.refresh_mode || 'full',
    'false',
    'false',
    data.max_tokens || 2048,
    'all_strict',
  );
  return Number(result.lastInsertRowid);
}

function seedMentalModelEntity(db, mmId, entId, overrides = {}) {
  db.prepare(`
    INSERT INTO mental_model_entities (
      ent_id, mm_id, mm_ent_refresh_mode, mm_ent_refresh_after_consolidation,
      mm_ent_exclude_all_mental_models, mm_ent_max_tokens
    ) VALUES (?, ?, ?, ?, ?, ?)
  `).run(
    entId,
    mmId,
    overrides.refresh_mode || null,
    overrides.refresh_after_consolidation || null,
    overrides.exclude_all_mental_models || null,
    overrides.max_tokens || 2048,
  );
}

function makeApp({ db }) {
  const app = express();
  app.use(express.json());
  app.locals.db = db;
  app.use('/api/v1/entities', entitiesRouter);
  return app;
}

function makeRequest(app, body) {
  return request(app)
    .post('/api/v1/entities/info')
    .send(body)
    .set('Accept', 'application/json');
}

describe('POST /api/v1/entities/info', () => {
  let db;
  let serverId;
  let bankId;

  beforeEach(() => {
    db = makeDb();
    serverId = seedServer(db);
    bankId = 'Mozart-API';
  });

  it('returns 400 when the payload is invalid', async () => {
    const app = makeApp({ db });
    const res = await makeRequest(app, {});
    assert.equal(res.status, 400);
    assert.equal(res.body.code, 'VALIDATION_ERROR');
  });

  it('returns empty info for unknown entities', async () => {
    const app = makeApp({ db });
    seedEntityType(db, 'Service', 'svc');
    const res = await makeRequest(app, {
      server_id: serverId,
      bank_id: bankId,
      entity_ids: ['svc:UNKNOWN'],
    });

    assert.equal(res.status, 200);
    assert.equal(res.body.meta.requested_count, 1);
    assert.equal(res.body.meta.graph_nodes_found, 0);
    assert.equal(res.body.meta.catalog_entities_found, 0);
    assert.equal(res.body.entities['svc:UNKNOWN'].graph_node, null);
    assert.equal(res.body.entities['svc:UNKNOWN'].catalog, null);
    assert.deepEqual(res.body.entities['svc:UNKNOWN'].contextual_refs, []);
    assert.deepEqual(res.body.entities['svc:UNKNOWN'].derived_models, []);
    assert.deepEqual(res.body.entities['svc:UNKNOWN'].plain_models, []);
  });

  it('returns graph node, catalog metadata and contextual refs', async () => {
    const app = makeApp({ db });
    const typeId = seedEntityType(db, 'Service', 'svc');
    seedEntity(db, typeId, 'SVC-005', 'Payment Service');

    seedGraphNode(db, serverId, bankId, 'svc:SVC-005', ['grounded', 'Service'], {
      display_name: 'Payment Service',
      provenance: {
        model_refs: [
          {
            role: 'sys_entity_summary',
            ext_id: 'entity-summary-svc:SVC-005',
            scope: 'node',
            attached_at: '2026-01-01T00:00:00Z',
          },
          {
            role: 'sys_entity_capabilities',
            ext_id: 'entity-capabilities-svc:SVC-005',
            scope: 'node',
          },
        ],
      },
    });

    const res = await makeRequest(app, {
      server_id: serverId,
      bank_id: bankId,
      entity_ids: ['svc:SVC-005'],
    });

    assert.equal(res.status, 200);
    const info = res.body.entities['svc:SVC-005'];
    assert.equal(info.graph_node.id, 'svc:SVC-005');
    assert.equal(info.graph_node.is_grounded, true);
    assert.equal(info.catalog.name, 'Payment Service');
    assert.equal(info.catalog.type_name, 'Service');
    assert.equal(info.contextual_refs.length, 2);
    assert.equal(info.contextual_refs[0].role, 'sys_entity_summary');
    assert.equal(info.contextual_refs[0].ext_id, 'entity-summary-svc:SVC-005');
  });

  it('returns derived and plain mental models linked to the entity', async () => {
    const app = makeApp({ db });
    const typeId = seedEntityType(db, 'Service', 'SVC');
    const entId = seedEntity(db, typeId, 'SVC-005', 'Payment Service');

    const userTemplateId = seedMentalModel(db, {
      ext_id: 'user-template-risk-{entity-id}',
      name: 'Risk profile: {entity-name}',
      is_template: true,
      template_role: 'user_entity_derived',
      dimension: 'risk',
      returns: 'narrative',
      source_query: 'Risk profile for {entity-id}',
    });
    seedMentalModelEntity(db, userTemplateId, entId);

    const plainModelId = seedMentalModel(db, {
      ext_id: 'plain-security-review',
      name: 'Security review',
      is_template: false,
      dimension: 'security',
      returns: 'table',
    });
    seedMentalModelEntity(db, plainModelId, entId);

    const systemTemplateId = seedMentalModel(db, {
      ext_id: 'test-entity-summary-{id}',
      name: 'Test entity summary: {entity-name}',
      is_template: true,
      template_role: 'sys_entity_summary',
    });
    seedMentalModelEntity(db, systemTemplateId, entId);

    const res = await makeRequest(app, {
      server_id: serverId,
      bank_id: bankId,
      entity_ids: ['svc:SVC-005'],
    });

    assert.equal(res.status, 200);
    const info = res.body.entities['svc:SVC-005'];
    assert.equal(info.derived_models.length, 1);
    assert.equal(info.derived_models[0].template_role, 'user_entity_derived');
    assert.equal(info.derived_models[0].ext_id, 'user-template-risk-SVC-005');
    assert.equal(info.derived_models[0].name, 'Risk profile: Payment Service');
    assert.equal(info.derived_models[0].meta.derived_from.template_id, userTemplateId);
    assert.equal(info.derived_models[0].meta.derived_from.template_ext_id, 'user-template-risk-{entity-id}');

    assert.equal(info.plain_models.length, 1);
    assert.equal(info.plain_models[0].id, plainModelId);
    assert.equal(info.plain_models[0].ext_id, 'plain-security-review');
    assert.equal(info.plain_models[0].returns, 'table');

    // System template linked directly to the entity must not appear in derived_models.
    assert.ok(!info.derived_models.some((m) => m.template_role.startsWith('sys_')));
    // Plain and derived models share the same top-level schema.
    const derivedKeys = Object.keys(info.derived_models[0]).sort();
    const plainKeys = Object.keys(info.plain_models[0]).sort();
    assert.deepEqual(derivedKeys, plainKeys);
  });

  it('returns edge contexts between any two requested entities', async () => {
    const app = makeApp({ db });
    const svcTypeId = seedEntityType(db, 'Service', 'SVC');
    const appTypeId = seedEntityType(db, 'Application', 'APP');
    seedEntity(db, svcTypeId, 'SVC-005', 'Payment Service');
    seedEntity(db, appTypeId, 'APP-001', 'Web App');

    seedGraphNode(db, serverId, bankId, 'svc:SVC-005', ['grounded', 'Service'], {
      display_name: 'Payment Service',
      provenance: { model_refs: [] },
    });
    seedGraphNode(db, serverId, bankId, 'app:APP-001', ['grounded', 'Application'], {
      display_name: 'Web App',
      provenance: { model_refs: [] },
    });

    seedGraphEdge(db, serverId, bankId, 'edge-1', 'svc:SVC-005', 'app:APP-001', 'CALLS', {
      directed: false,
      provenance: {
        model_refs: [
          {
            role: 'sys_edge_context',
            ext_id: 'edge-ctx-svc:SVC-005|app:APP-001',
            scope: { source_id: 'svc:SVC-005', target_id: 'app:APP-001' },
          },
        ],
      },
    });

    const res = await makeRequest(app, {
      server_id: serverId,
      bank_id: bankId,
      entity_ids: ['svc:SVC-005', 'app:APP-001'],
    });

    assert.equal(res.status, 200);
    const a = res.body.entities['svc:SVC-005'];
    const b = res.body.entities['app:APP-001'];
    assert.equal(a.edge_contexts.length, 1);
    assert.equal(b.edge_contexts.length, 1);
    assert.equal(a.edge_contexts[0].edge_id, 'edge-1');
    assert.equal(a.edge_contexts[0].refs[0].ext_id, 'edge-ctx-svc:SVC-005|app:APP-001');
    assert.deepEqual(a.edge_contexts[0].scope, { source_id: 'svc:SVC-005', target_id: 'app:APP-001' });
  });

  it('returns edge contexts for a single requested entity when the other endpoint is not requested', async () => {
    const app = makeApp({ db });
    const svcTypeId = seedEntityType(db, 'Service', 'SVC');
    const appTypeId = seedEntityType(db, 'Application', 'APP');
    seedEntity(db, svcTypeId, 'SVC-005', 'Payment Service');
    seedEntity(db, appTypeId, 'APP-001', 'Web App');

    seedGraphNode(db, serverId, bankId, 'svc:SVC-005', ['grounded', 'Service'], {
      display_name: 'Payment Service',
      provenance: { model_refs: [] },
    });
    seedGraphNode(db, serverId, bankId, 'app:APP-001', ['grounded', 'Application'], {
      display_name: 'Web App',
      provenance: { model_refs: [] },
    });

    seedGraphEdge(db, serverId, bankId, 'edge-1', 'svc:SVC-005', 'app:APP-001', 'CALLS', {
      directed: false,
      provenance: {
        model_refs: [
          {
            role: 'sys_edge_context',
            ext_id: 'edge-ctx-svc:SVC-005|app:APP-001',
            scope: { source_id: 'svc:SVC-005', target_id: 'app:APP-001' },
          },
        ],
      },
    });

    const res = await makeRequest(app, {
      server_id: serverId,
      bank_id: bankId,
      entity_ids: ['svc:SVC-005'],
    });

    assert.equal(res.status, 200);
    const info = res.body.entities['svc:SVC-005'];
    assert.equal(info.edge_contexts.length, 1);
    assert.equal(info.edge_contexts[0].edge_id, 'edge-1');
    assert.deepEqual(info.edge_contexts[0].scope, { source_id: 'svc:SVC-005', target_id: 'app:APP-001' });
  });

  it('accepts whatever prefix is configured in the entity type table', async () => {
    const app = makeApp({ db });
    // User-chosen prefix "foo-bar" with type name "Service"
    const typeId = seedEntityType(db, 'Service', 'foo-bar');
    seedEntity(db, typeId, 'SVC-005', 'Payment Service');

    seedGraphNode(db, serverId, bankId, 'foo-bar:SVC-005', ['grounded', 'Service'], {
      display_name: 'Payment Service',
      provenance: { model_refs: [] },
    });

    const res = await makeRequest(app, {
      server_id: serverId,
      bank_id: bankId,
      entity_ids: ['foo-bar:SVC-005'],
    });

    assert.equal(res.status, 200);
    const info = res.body.entities['foo-bar:SVC-005'];
    assert.equal(info.graph_node.id, 'foo-bar:SVC-005');
    assert.equal(info.catalog.type_name, 'Service');
  });
});

export {};
