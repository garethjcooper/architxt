import assert from 'node:assert/strict';
import test from 'node:test';
import { resolveRestrictions, DEFAULT_AUTO_RESTRICTIONS } from '../src/services/contextual-graph/server-bank-config.js';

test('resolveRestrictions', async (t) => {
  await t.test('auto bank without deploy restriction inherits default allowed_model_types', () => {
    const result = resolveRestrictions({ mode: 'auto', restriction: {} });
    assert.deepEqual(result.deploy.allowed_model_types, DEFAULT_AUTO_RESTRICTIONS.deploy.allowed_model_types);
    assert.equal(result.deploy.max_models_per_run, DEFAULT_AUTO_RESTRICTIONS.deploy.max_models_per_run);
  });

  await t.test('auto bank with explicit empty allowed_model_types deploys nothing', () => {
    const result = resolveRestrictions({
      mode: 'auto',
      restriction: { deploy: { allowed_model_types: [] } },
    });
    assert.deepEqual(result.deploy.allowed_model_types, []);
    assert.equal(result.deploy.max_models_per_run, DEFAULT_AUTO_RESTRICTIONS.deploy.max_models_per_run);
  });

  await t.test('auto bank with explicit allowed_model_types overrides default', () => {
    const result = resolveRestrictions({
      mode: 'auto',
      restriction: { deploy: { allowed_model_types: ['discover'] } },
    });
    assert.deepEqual(result.deploy.allowed_model_types, ['discover']);
  });

  await t.test('manual bank without restriction gets empty restrictions', () => {
    const result = resolveRestrictions({ mode: 'manual', restriction: {} });
    assert.deepEqual(result.deploy.allowed_model_types, undefined);
    assert.deepEqual(result.import, {});
    assert.deepEqual(result.deploy, {});
  });

  await t.test('import restrictions still merge over defaults', () => {
    const result = resolveRestrictions({
      mode: 'auto',
      restriction: { import: { top_k_nodes: 5 } },
    });
    assert.equal(result.import.top_k_nodes, 5);
    assert.equal(result.import.min_weight, DEFAULT_AUTO_RESTRICTIONS.import.min_weight);
  });
});
