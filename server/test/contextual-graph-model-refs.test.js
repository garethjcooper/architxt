import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  extractRefsFromProperties,
  extractModelRefs,
  stripModelRefsFromProperties } from '../src/services/contextual-graph/graph-model-refs.js';

describe('graph-model-refs', () => {
  it('extracts model_refs from properties', () => {
    const properties = {
      provenance: {
        model_refs: [
          { role: 'sys_entity_summary', ext_id: 'entity-summary-svc:SVC-005', attached_at: '2026-08-01' },
          { role: 'sys_edge_context', ext_id: 'edge-ctx-svc:SVC-005|svc:SVC-006', attached_at: '2026-08-02' },
        ] } };

    const refs = extractRefsFromProperties(properties);
    assert.deepEqual(refs.sort(), [
      'edge-ctx-svc:SVC-005|svc:SVC-006',
      'entity-summary-svc:SVC-005',
    ]);
  });

  it('filters by exact role', () => {
    const properties = {
      provenance: {
        model_refs: [
          { role: 'sys_entity_summary', ext_id: 'entity-summary-svc:SVC-005' },
          { role: 'sys_edge_context', ext_id: 'edge-ctx-svc:SVC-005|svc:SVC-006' },
        ] } };

    assert.deepEqual(extractRefsFromProperties(properties, { role: 'sys_edge_context' }), [
      'edge-ctx-svc:SVC-005|svc:SVC-006',
    ]);
  });

  it('extracts model refs from a graph object', () => {
    const graph = {
      nodes: [
        { id: 'svc:SVC-005', properties: { provenance: { model_refs: [{ role: 'sys_entity_summary', ext_id: 'entity-summary-svc:SVC-005' }] } } },
        { cgn_id: 'svc:SVC-006', cgn_properties: { provenance: { model_refs: [{ role: 'sys_entity_capabilities', ext_id: 'entity-capabilities-svc:SVC-006' }] } } },
      ],
      edges: [
        { id: 'edge-1', properties: { provenance: { model_refs: [{ role: 'sys_edge_context', ext_id: 'edge-ctx-pair' }] } } },
      ] };

    const { extIds, byNodeId, byEdgeId } = extractModelRefs(graph);
    assert.deepEqual(extIds.sort(), ['edge-ctx-pair', 'entity-capabilities-svc:SVC-006', 'entity-summary-svc:SVC-005']);
    assert.deepEqual(byNodeId.get('svc:SVC-005'), ['entity-summary-svc:SVC-005']);
    assert.deepEqual(byNodeId.get('svc:SVC-006'), ['entity-capabilities-svc:SVC-006']);
    assert.deepEqual(byEdgeId.get('edge-1'), ['edge-ctx-pair']);
  });

  it('strips model refs from properties', () => {
    const properties = {
      display_name: 'Billing Service',
      provenance: {
        source: 'contextual-graph',
        model_refs: [
          { role: 'sys_entity_summary', ext_id: 'entity-summary-svc:SVC-005' },
          { role: 'sys_edge_context', ext_id: 'edge-ctx-pair' },
        ],
        updated_at: '2026-08-01' } };

    const next = stripModelRefsFromProperties(properties, new Set(['entity-summary-svc:SVC-005']));
    assert.deepEqual(next.provenance.model_refs, [{ role: 'sys_edge_context', ext_id: 'edge-ctx-pair' }]);
    assert.equal(next.provenance.source, 'contextual-graph');
    assert.equal(next.provenance.updated_at, '2026-08-01');
  });

  it('removes empty provenance block when all refs are stripped', () => {
    const properties = {
      provenance: {
        model_refs: [{ role: 'sys_entity_summary', ext_id: 'entity-summary-svc:SVC-005' }] } };

    const next = stripModelRefsFromProperties(properties, new Set(['entity-summary-svc:SVC-005']));
    assert.equal(next.provenance, undefined);
  });

  it('returns null when no refs are present', () => {
    assert.deepEqual(extractRefsFromProperties({}), []);
    assert.equal(stripModelRefsFromProperties({ display_name: 'x' }, new Set(['y'])), null);
  });
});
