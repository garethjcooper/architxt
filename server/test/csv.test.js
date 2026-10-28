import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { toCsv } from '../src/utils/csv.js';

describe('toCsv', () => {
  it('returns empty files for an empty graph', () => {
    const { nodes, edges } = toCsv([], []);
    assert.equal(nodes, 'id,labels');
    assert.equal(edges, 'id,source_id,target_id,type,directed');
  });

  it('exports nodes with labels and properties', () => {
    const { nodes } = toCsv([
      { id: 'n1', labels: ['Entity'], properties: { name: 'Alpha', count: 3 } },
      { id: 'n2', labels: ['Candidate'], properties: { name: 'Beta', ok: false } },
    ], []);

    const lines = nodes.split('\n');
    assert.equal(lines[0], 'id,labels,name,count,ok');
    assert.ok(lines.includes('n1,Entity,Alpha,3,'));
    assert.ok(lines.includes('n2,Candidate,Beta,,false'));
  });

  it('exports edges with source, target, type and directed', () => {
    const { edges } = toCsv([], [
      { id: 'e1', source_id: 'n1', target_id: 'n2', type: 'sends', properties: { weight: 1.5 } },
    ]);

    const lines = edges.split('\n');
    assert.equal(lines[0], 'id,source_id,target_id,type,directed,weight');
    assert.ok(lines.includes('e1,n1,n2,sends,true,1.5'));
  });

  it('marks directed false when properties.directed is false', () => {
    const { edges } = toCsv([], [
      { id: 'e1', source_id: 'n1', target_id: 'n2', type: 'links', properties: { directed: false } },
    ]);

    assert.ok(edges.split('\n').includes('e1,n1,n2,links,false'));
  });

  it('marks directed false when global undirected is true', () => {
    const { edges } = toCsv([], [
      { id: 'e1', source_id: 'n1', target_id: 'n2', type: 'links', properties: {} },
    ], {}, true);

    assert.ok(edges.split('\n').includes('e1,n1,n2,links,false'));
  });

  it('escapes fields containing commas, quotes, and newlines', () => {
    const { nodes } = toCsv([
      { id: 'n1', labels: ['A', 'B'], properties: { desc: 'line one\nline "two", and three' } },
    ], []);

    assert.ok(nodes.startsWith('id,labels,desc\nn1,A;B,'));
    assert.ok(nodes.includes('"line one\nline ""two"", and three"'));
  });

  it('stringifies object and array properties as JSON', () => {
    const { nodes, edges } = toCsv(
      [{ id: 'n1', labels: [], properties: { tags: ['a', 'b'], meta: { x: 1 } } }],
      [{ id: 'e1', source_id: 'n1', target_id: 'n1', type: 'self', properties: { payload: { y: 2 } } }],
    );

    const nodeLines = nodes.split('\n').filter(Boolean);
    const edgeLines = edges.split('\n').filter(Boolean);
    assert.ok(nodeLines.includes('n1,,\"[\"\"a\"\",\"\"b\"\"]\",\"{\"\"x\"\":1}\"'));
    assert.ok(edgeLines.includes('e1,n1,n1,self,true,\"{\"\"y\"\":2}\"'));
  });

  it('preserves null edge type as empty string', () => {
    const { edges } = toCsv([], [
      { id: 'e1', source_id: 'n1', target_id: 'n2', type: null, properties: {} },
    ]);

    assert.ok(edges.split('\n').includes('e1,n1,n2,,true'));
  });

  it('deduplicates and keeps property keys in first-seen order', () => {
    const { nodes } = toCsv([
      { id: 'a', labels: [], properties: { z: 1, a: 2 } },
      { id: 'b', labels: [], properties: { a: 3, b: 4, z: 5 } },
    ], []);

    assert.equal(nodes.split('\n')[0], 'id,labels,z,a,b');
    assert.ok(nodes.split('\n').includes('a,,1,2,'));
    assert.ok(nodes.split('\n').includes('b,,5,3,4'));
  });

  it('returns file metadata and exposes both files', () => {
    const result = toCsv(
      [{ id: 'n1', labels: ['X'], properties: {} }],
      [{ id: 'e1', source_id: 'n1', target_id: 'n1', type: 't', properties: {} }],
      { server_id: 1, bank_id: 'bank', generated_at: '2026-01-01T00:00:00.000Z' },
    );

    assert.equal(result.files.length, 2);
    assert.equal(result.files[0].name, 'nodes.csv');
    assert.equal(result.files[1].name, 'edges.csv');
    assert.equal(result.meta.format, 'csv');
    assert.equal(result.meta.node_count, 1);
    assert.equal(result.meta.edge_count, 1);
  });
});
