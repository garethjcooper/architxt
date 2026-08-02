import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  extractRefsFromProperties,
  extractModelRefs,
  stripModelRefsFromProperties,
} from '../src/services/contextual-graph/graph-model-refs.js';

describe('graph-model-refs', () => {
  it('extracts model_id and model_refs from properties', () => {
    const properties = {
      provenance: {
        model_id: 'entity-ctx-svc:SVC-005',
        model_refs: [
          { role: 'entity-ctx', ext_id: 'entity-ctx-svc:SVC-005', attached_at: '2026-08-01' },
          { role: 'edge-ctx', ext_id: 'edge-ctx-svc:SVC-005|svc:SVC-006', attached_at: '2026-08-02' },
        ],
      },
    };

    const refs = extractRefsFromProperties(properties);
    assert.deepEqual(refs.sort(), [
      'edge-ctx-svc:SVC-005|svc:SVC-006',
      'entity-ctx-svc:SVC-005',
    ]);
  });

  it('filters by role prefix', () => {
    const properties = {
      provenance: {
        model_id: 'entity-ctx-svc:SVC-005',
        model_refs: [
          { role: 'entity-ctx', ext_id: 'entity-ctx-svc:SVC-005' },
          { role: 'edge-ctx', ext_id: 'edge-ctx-svc:SVC-005|svc:SVC-006' },
        ],
      },
    };

    assert.deepEqual(extractRefsFromProperties(properties, { rolePrefix: 'edge-ctx' }), [
      'edge-ctx-svc:SVC-005|svc:SVC-006',
    ]);
  });

  it('extracts model refs from a graph object', () => {
    const graph = {
      nodes: [
        { id: 'svc:SVC-005', properties: { provenance: { model_id: 'entity-ctx-svc:SVC-005' } } },
        { cgn_id: 'svc:SVC-006', cgn_properties: { provenance: { model_refs: [{ role: 'entity-ctx', ext_id: 'entity-ctx-svc:SVC-006' }] } } },
      ],
      edges: [
        { id: 'edge-1', properties: { provenance: { model_refs: [{ role: 'edge-ctx', ext_id: 'edge-ctx-pair' }] } } },
      ],
    };

    const { extIds, byNodeId, byEdgeId } = extractModelRefs(graph);
    assert.deepEqual(extIds.sort(), ['edge-ctx-pair', 'entity-ctx-svc:SVC-005', 'entity-ctx-svc:SVC-006']);
    assert.deepEqual(byNodeId.get('svc:SVC-005'), ['entity-ctx-svc:SVC-005']);
    assert.deepEqual(byNodeId.get('svc:SVC-006'), ['entity-ctx-svc:SVC-006']);
    assert.deepEqual(byEdgeId.get('edge-1'), ['edge-ctx-pair']);
  });

  it('strips model refs from properties', () => {
    const properties = {
      display_name: 'Billing Service',
      provenance: {
        source: 'contextual-graph',
        model_id: 'entity-ctx-svc:SVC-005',
        model_refs: [
          { role: 'entity-ctx', ext_id: 'entity-ctx-svc:SVC-005' },
          { role: 'edge-ctx', ext_id: 'edge-ctx-pair' },
        ],
        updated_at: '2026-08-01',
      },
    };

    const next = stripModelRefsFromProperties(properties, new Set(['entity-ctx-svc:SVC-005']));
    assert.equal(next.provenance.model_id, undefined);
    assert.deepEqual(next.provenance.model_refs, [{ role: 'edge-ctx', ext_id: 'edge-ctx-pair' }]);
    assert.equal(next.provenance.source, 'contextual-graph');
    assert.equal(next.provenance.updated_at, '2026-08-01');
  });

  it('removes empty provenance block when all refs are stripped', () => {
    const properties = {
      provenance: {
        model_id: 'entity-ctx-svc:SVC-005',
      },
    };

    const next = stripModelRefsFromProperties(properties, new Set(['entity-ctx-svc:SVC-005']));
    assert.equal(next.provenance, undefined);
  });

  it('returns null when no refs are present', () => {
    assert.deepEqual(extractRefsFromProperties({}), []);
    assert.equal(stripModelRefsFromProperties({ display_name: 'x' }, new Set(['y'])), null);
  });
});
