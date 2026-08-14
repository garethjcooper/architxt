import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

// The service imports from ESM files that depend on cache/logger; we test the
// payload builder via a small helper extracted here. buildPayload is a pure
// function aside from logger.warn, so we import it by reading the module with
// NODE_ENV set to keep side effects minimal.
process.env.NODE_ENV = 'test';

const { buildPayload } = await import('../../../src/services/hindsight/push-mental-model.js');

describe('push-mental-model buildPayload', () => {
  it('uses composed_query when present', () => {
    const payload = buildPayload({
      ext_id: 'SVC-001',
      name: 'Test',
      composed_query: 'composed prompt',
      source_query: 'raw prompt',
    });
    assert.equal(payload.source_query, 'composed prompt');
  });

  it('falls back to source_query when composed_query is missing', () => {
    const payload = buildPayload({
      ext_id: 'SV-SECURITY-001',
      name: 'Security',
      source_query: 'Assess security of {{ARCHITXT_TOPIC}}.',
    });
    assert.equal(payload.source_query, 'Assess security of {{ARCHITXT_TOPIC}}.');
  });

  it('throws when both composed_query and source_query are empty', () => {
    assert.throws(
      () => buildPayload({ ext_id: 'EMPTY-001', name: 'Empty' }),
      /has no composed_query or source_query/
    );
  });

  it('applies normalised trigger defaults', () => {
    const payload = buildPayload({
      ext_id: 'DEFAULTS-001',
      source_query: 'hello',
    });
    assert.equal(payload.trigger.mode, 'full');
    assert.equal(payload.trigger.refresh_after_consolidation, false);
    assert.equal(payload.trigger.tags_match, 'all_strict');
  });
});
