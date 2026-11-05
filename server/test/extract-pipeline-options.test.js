import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { getExtractPipelineDefinition, getStageNames } from '../src/daemons/extract/pipeline-runner.js';

/**
 * Unit tests for per-document processing-options overrides.
 * These tests do NOT exercise the full registry/config wiring; they focus on
 * the override merging logic in getExtractPipelineDefinition / getStageNames.
 */
describe('getExtractPipelineDefinition', () => {
  it('uses global config defaults when no document is supplied', () => {
    const def = getExtractPipelineDefinition();
    const names = def.stages.map(s => s.stage);
    assert.deepEqual(names, ['extract', 'denoise', 'denoise-llm', 'vision']);
  });

  it('uses global config defaults when document has no processing_options', () => {
    const def = getExtractPipelineDefinition({ doc_id: 1, doc_filename: 'test.md' });
    const names = def.stages.map(s => s.stage);
    assert.deepEqual(names, ['extract', 'denoise', 'denoise-llm', 'vision']);
  });

  it('disables a stage when document options explicitly set it to false', () => {
    const def = getExtractPipelineDefinition({
      doc_processing_options: { stages: { 'denoise-llm': false } }
    });
    const names = def.stages.map(s => s.stage);
    assert.deepEqual(names, ['extract', 'denoise', 'vision']);
  });

  it('disables multiple stages when requested', () => {
    const def = getExtractPipelineDefinition({
      doc_processing_options: { stages: { denoise: false, 'denoise-llm': false, vision: false } }
    });
    const names = def.stages.map(s => s.stage);
    assert.deepEqual(names, ['extract']);
  });

  it('can enable a stage that is globally disabled', () => {
    const def = getExtractPipelineDefinition({
      doc_processing_options: { stages: { vision: true } }
    });
    const names = def.stages.map(s => s.stage);
    assert.ok(names.includes('vision'));
  });

  it('only affects named stages and leaves unset stages at global default', () => {
    const def = getExtractPipelineDefinition({
      doc_processing_options: { stages: { vision: false } }
    });
    const names = def.stages.map(s => s.stage);
    assert.deepEqual(names, ['extract', 'denoise', 'denoise-llm']);
  });
});

describe('getStageNames', () => {
  it('returns default stage names without document', () => {
    const names = getStageNames();
    assert.deepEqual(names, ['extract', 'denoise', 'denoise-llm', 'vision']);
  });

  it('returns stage names honoring per-document overrides', () => {
    const names = getStageNames({
      doc_processing_options: { stages: { 'denoise-llm': false } }
    });
    assert.deepEqual(names, ['extract', 'denoise', 'vision']);
  });
});
