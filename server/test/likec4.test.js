import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { toLikeC4 } from '../src/utils/likec4.js';

const meta = { bank_id: 'demo-bank', generated_at: '2026-11-22T00:00:00Z' };

function makeNodeMap(entries) {
  return new Map(entries.map(([id, v]) => [id, {
    c4Element: null,
    archimateElement: null,
    likec4Shape: null,
    typeName: null,
    defaulted: true,
    ...v,
  }]));
}

function makeEdgeMap(entries) {
  return new Map(entries.map(([id, v]) => [id, {
    c4Description: null,
    archimateRelationship: null,
    typeName: null,
    defaulted: true,
    ...v,
  }]));
}

describe('toLikeC4 serializer', () => {
  it('emits specification with one element kind per entity type', () => {
    const nodes = [
      { id: 'a-com:COM-001', labels: ['canonical', 'a-com'], properties: { name: 'Orders API' } },
      { id: 'db:DB-001', labels: ['db'], properties: { name: 'Orders DB' } },
    ];
    const edges = [];
    const nodeMap = makeNodeMap([
      ['a-com:COM-001', { typeName: 'a-com', likec4Shape: 'component' }],
      ['db:DB-001', { typeName: 'db', likec4Shape: 'storage', defaulted: false }],
    ]);
    const out = toLikeC4(nodes, edges, meta, false, nodeMap, makeEdgeMap([]));

    assert.match(out, /^specification \{/m);
    assert.match(out, /element a-com \{/);
    assert.match(out, /shape component/);
    assert.match(out, /element db \{/);
    assert.match(out, /shape storage/);
    assert.match(out, /^model \{/m);
    assert.match(out, /a-com-COM-001 = a-com 'Orders API'/);
    assert.match(out, /db-DB-001 = db 'Orders DB'/);
    assert.match(out, /views \{\n  view index \{\n    include \*\n  \}\n\}/);
  });

  it('defaults unmapped nodes to a fallback element kind', () => {
    const nodes = [{ id: 'x:1', labels: [], properties: {} }];
    const out = toLikeC4(nodes, [], meta, false, makeNodeMap([]), makeEdgeMap([]));
    assert.match(out, /element element/);
    assert.match(out, /x-1 = element 'x:1'/);
  });

  it('sanitizes identifiers: leading digits, spaces, dots', () => {
    const nodes = [
      { id: '9lives', labels: [], properties: { name: 'Nine' } },
      { id: 'my.node id', labels: [], properties: { name: 'Dotty' } },
    ];
    const out = toLikeC4(nodes, [], meta, false, makeNodeMap([]), makeEdgeMap([]));
    assert.match(out, /id-9lives = element/);
    assert.match(out, /my-node-id = element/);
    assert.ok(!/ id\.id /.test(out));
  });

  it('dedupes colliding element names', () => {
    const nodes = [
      { id: 'a-b', labels: [], properties: {} },
      { id: 'a b', labels: [], properties: {} },
    ];
    const out = toLikeC4(nodes, [], meta, false, makeNodeMap([]), makeEdgeMap([]));
    assert.match(out, /a-b = element/);
    assert.match(out, /a-b-2 = element/);
  });

  it('emits kinded directed relationships with title', () => {
    const nodes = [
      { id: 'api:1', labels: ['a-svc'], properties: { name: 'API' } },
      { id: 'db:1', labels: ['db'], properties: { name: 'DB' } },
    ];
    const edges = [{ id: 'e1', source_id: 'api:1', target_id: 'db:1', type: 'writes', properties: {} }];
    const nodeMap = makeNodeMap([
      ['api:1', { typeName: 'a-svc', defaulted: false }],
      ['db:1', { typeName: 'db', defaulted: false }],
    ]);
    const edgeMap = makeEdgeMap([['e1', { typeName: 'writes', c4Description: 'persists or writes data to', defaulted: false }]]);
    const out = toLikeC4(nodes, edges, meta, false, nodeMap, edgeMap);

    assert.match(out, /relationship writes \{/);
    assert.match(out, /title 'persists or writes data to'/);
    assert.match(out, /api-1 -\[writes\]-> db-1 'persists or writes data to'/);
  });

  it('emits bidirectional relationships with <-> for undirected edges', () => {
    const nodes = [
      { id: 'a', labels: [], properties: {} },
      { id: 'b', labels: [], properties: {} },
    ];
    const edges = [{ id: 'e1', source_id: 'a', target_id: 'b', type: 'depends-on', properties: { directed: false } }];
    const edgeMap = makeEdgeMap([['e1', { typeName: 'depends-on', c4Description: 'depends on', defaulted: false }]]);
    const out = toLikeC4(nodes, edges, meta, false, makeNodeMap([]), edgeMap);
    assert.match(out, /a -\[depends-on\]<-> b 'depends on'/);
  });

  it('emits plain arrow for untyped edges', () => {
    const nodes = [
      { id: 'a', labels: [], properties: {} },
      { id: 'b', labels: [], properties: {} },
    ];
    const edges = [{ id: 'e1', source_id: 'a', target_id: 'b', type: null, properties: {} }];
    const out = toLikeC4(nodes, edges, meta, false, makeNodeMap([]), makeEdgeMap([]));
    assert.match(out, /a -> b 'relates to'/);
  });

  it('skips edges whose endpoints are not in the node set', () => {
    const nodes = [{ id: 'a', labels: [], properties: {} }];
    const edges = [{ id: 'e1', source_id: 'a', target_id: 'ghost', type: null, properties: {} }];
    const out = toLikeC4(nodes, edges, meta, false, makeNodeMap([]), makeEdgeMap([]));
    assert.ok(!out.includes('ghost'));
  });

  it('escapes quotes and uses triple-quoted markdown for multi-line descriptions', () => {
    const nodes = [
      { id: 'a', labels: [], properties: { name: "D'Arcy", description: 'line one\nline **two**' } },
    ];
    const out = toLikeC4(nodes, [], meta, false, makeNodeMap([]), makeEdgeMap([]));
    assert.match(out, /D\\'Arcy/);
    assert.match(out, /description '''line one\nline \*\*two\*\*'''/);
  });

  it('sets original type name as kind title when sanitization changed it', () => {
    const nodes = [{ id: 'n1', labels: ['Payment Service'], properties: { name: 'Pay' } }];
    const nodeMap = makeNodeMap([['n1', { typeName: 'Payment Service', defaulted: false }]]);
    const out = toLikeC4(nodes, [], meta, false, nodeMap, makeEdgeMap([]));
    assert.match(out, /element Payment-Service \{/);
    assert.match(out, /title 'Payment Service'/);
  });
});
