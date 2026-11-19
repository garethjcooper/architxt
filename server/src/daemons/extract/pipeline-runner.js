import { createLogger } from '../../utils/logger.js';
import { config } from '../../config.js';
import { buildPipeline, createRunner, registry } from '../../pipeline/index.js';
import { createProgressReporter } from './progress.js';

const logger = createLogger('extract-daemon-pipeline');

/**
 * Extract final outputs from provenance log for API reporting
 * Finds the latest 'document-md' and 'document-images' from any stage
 *
 * Treats final outputs like stage inputs - resolves the latest occurrence
 * from the provenance log across all stages.
 *
 * @param {Array} provenanceLog - Pipeline provenance log [{index, name, items}, ...]
 * @returns {Object} { markdown, images }
 */
export function extractFinalOutputs(provenanceLog) {
  if (!provenanceLog || provenanceLog.length === 0) {
    return { markdown: '', images: [] };
  }

  // Flatten all outputs from all stages
  // Each entry: {index, name, items: [{name, data, type}, ...]}
  const allOutputs = [];

  for (const entry of provenanceLog) {
    if (entry.items && Array.isArray(entry.items)) {
      for (const item of entry.items) {
        allOutputs.push({
          stageIndex: entry.index,
          stageName: entry.name,
          ...item  // name, data, type
        });
      }
    }
  }

  // Find the latest (last) occurrence of each artifact
  // Later stages override earlier ones
  const latestMarkdown = allOutputs
    .filter(item => item.name === 'document-md')
    .pop();

  const latestImages = allOutputs
    .filter(item => item.name === 'document-images')
    .pop();

  return {
    markdown: latestMarkdown?.data ?? '',
    images: latestImages?.data ?? []
  };
}

/**
 * Get pipeline definition for trace extract workflow
 *
 * Trace documents bypass docling/denoise/vision and run a deterministic
 * profile-driven parser instead. The output is then persisted by the shared
 * persist stage.
 *
 * @param {Object} doc - Document row (must include doc_processing_options and trace_profile)
 * @returns {Object} Pipeline definition with stages array
 */
export function getExtractTracePipelineDefinition(doc = {}) {
  return {
    name: 'extract-trace',
    stages: [
      {
        stage: 'extract-trace',
        config: { storage_path: config.storage_path },
        data: {},
        services: {},
        timeoutMs: config.traceExtract?.timeout_ms || null,
      }
    ]
  };
}

/**
 * Get pipeline definition for repository extract workflow
 *
 * Repository documents are analyzed by gitdiagram-serve (external service):
 * the repo path is sent over HTTP and the service returns a Mermaid diagram
 * plus an explanation, which becomes the document content.
 *
 * @param {Object} doc - Document row (must include doc_source_path = repo path)
 * @returns {Object} Pipeline definition with stages array
 */
export function getExtractRepositoryPipelineDefinition(doc = {}) {
  return {
    name: 'extract-repository',
    stages: [
      {
        stage: 'extract-repository',
        config: { gitdiagram: config.gitdiagram, storage_path: config.storage_path },
        data: {},
        services: {},
        timeoutMs: config.gitdiagram?.timeoutMs || null,
      }
    ]
  };
}

/**
 * Get pipeline definition for extract workflow
 * Stages are conditionally included based on global config and per-document
 * processing_options overrides. The `doc` parameter is optional and defaults
 * to an empty object when callers don't have a document instance.
 *
 * @param {Object} doc - Document row (may include doc_processing_options)
 * @returns {Object} Pipeline definition with stages array
 */
export function getExtractPipelineDefinition(doc = {}) {
  const options = doc.doc_processing_options || {};
  const stageOverrides = options.stages || {};

  const stages = [
    // Stage 1: Source file extraction (always present)
    {
      stage: 'extract',
      config: { storage_path: config.storage_path },
      data: {},
      services: {}
    }
  ];

  // Stage 2: Text cleaning (rule-based denoise)
  if (stageOverrides.denoise ?? config.document_denoise.enabled) {
    stages.push({
      stage: 'denoise',
      config: { document_denoise: config.document_denoise },
      data: {},
      services: {}
    });
  }

  // Stage 3: LLM-based denoise
  if (stageOverrides['denoise-llm'] ?? config.document_denoise_llm.enabled) {
    stages.push({
      stage: 'denoise-llm',
      config: { document_denoise_llm: config.document_denoise_llm },
      data: {},
      services: {}
    });
  }

  // Stage 4: Image analysis / vision
  if (stageOverrides.vision ?? config.diagram_description.enabled) {
    stages.push({
      stage: 'vision',
      config: { diagram_description: config.diagram_description },
      data: {},
      services: {}
    });
  }

  return {
    name: 'extract-basic',
    stages
  };
}

/**
 * Resolve extract stage names for a given document.
 * Mirrors the per-document override logic in getExtractPipelineDefinition.
 *
 * @param {Object} doc - Document row
 * @returns {string[]} Stage names
 */
export function getStageNames(doc = {}) {
  const options = doc.doc_processing_options || {};
  const overrides = options.stages || {};

  const names = ['extract'];
  if (overrides.denoise ?? config.document_denoise.enabled) names.push('denoise');
  if (overrides['denoise-llm'] ?? config.document_denoise_llm.enabled) names.push('denoise-llm');
  if (overrides.vision ?? config.diagram_description.enabled) names.push('vision');
  return names;
}

/**
 * Process a single document using the configured pipeline.
 *
 * @param {Object} doc - Document object with id, filename, etc
 * @param {AbortSignal} abortSignal - AbortController signal for cancellation
 * @returns {Promise<Object>} Processing result with success, metrics, markdown, images
 */
export async function processDocument(doc, abortSignal) {
  logger.info('Processing document', { docId: doc.id, filename: doc.filename, sourceType: doc.source_type });

  const sourceType = doc.source_type || 'document';
  const pipelineDef = sourceType === 'trace'
    ? getExtractTracePipelineDefinition(doc)
    : sourceType === 'repository'
      ? getExtractRepositoryPipelineDefinition(doc)
      : getExtractPipelineDefinition(doc);

  // Populate stage data with document info
  pipelineDef.stages.forEach(stage => {
    stage.data = {
      doc_id: doc.id,
      source_path: doc.source_path,
      filename: doc.filename || doc.doc_filename,
      doc_processing_options: doc.doc_processing_options || {},
      ...(sourceType === 'trace' && stage.stage === 'extract-trace' ? { trace_profile: doc.trace_profile } : {})
    };
  });

  return runPipeline(pipelineDef, doc, abortSignal);
}

async function runPipeline(pipelineDef, doc, abortSignal) {
  const pipeline = buildPipeline(pipelineDef, registry);

  // Stage names for progress reporting — derived from the actual pipeline definition
  const stages = pipeline.stages
    .filter(s => s.index !== -1)
    .map(s => ({ name: s.name }));

  // Create progress reporter for this document
  const reporter = createProgressReporter(doc.id, stages);

  // Create runner with reporter
  const runner = createRunner({ reporter });

  try {
    // Execute pipeline
    const seedOutput = {};  // Empty seed - no initial artifacts needed
    const options = { signal: abortSignal };
    const result = await runner.execute(pipeline, seedOutput, options);

    // Merge reporter's final stage metrics (includes per-item aggregates) into results
    const reporterState = reporter.getState();
    const mergedMetrics = result.results.reduce((acc, r) => {
      const reporterStage = reporterState?.[r.stage];
      acc[r.stage] = {
        ...r.metrics,
        ...(reporterStage?.metrics || {})
      };
      return acc;
    }, {});

    return {
      success: result.success,
      metrics: mergedMetrics,
      error: result.success ? null : result.errors.join(', '),
      errorDetails: result.success ? null : result.results
        .filter((r) => !r.success)
        .map((r) => ({ stage: r.stage, error: r.error, metrics: r.metrics })),
      provenance_log: result.provenanceLog,
      // Extract final outputs from provenance log for API reporting
      ...extractFinalOutputs(result.provenanceLog)
    };
  } catch (err) {
    logger.error('Pipeline execution failed', { docId: doc.id, error: err.message });
    return {
      success: false,
      error: err.message,
      metrics: {},
      provenance_log: null,
      markdown: '',
      images: []
    };
  }
}
