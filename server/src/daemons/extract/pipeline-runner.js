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
 * Get pipeline definition for extract workflow
 * Stages are conditionally included based on their enabled config flag.
 *
 * @returns {Object} Pipeline definition with stages array
 */
export function getExtractPipelineDefinition() {
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
  if (config.document_denoise.enabled) {
    stages.push({
      stage: 'denoise',
      config: { document_denoise: config.document_denoise },
      data: {},
      services: {}
    });
  }

  // Stage 3: LLM-based denoise
  if (config.document_denoise_llm.enabled) {
    stages.push({
      stage: 'denoise-llm',
      config: { document_denoise_llm: config.document_denoise_llm },
      data: {},
      services: {}
    });
  }

  // Stage 4: Image analysis / vision
  if (config.diagram_description.enabled) {
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
 * Process a single document using v3 pipeline
 * 
 * @param {Object} doc - Document object with id, filename, etc
 * @param {AbortSignal} abortSignal - AbortController signal for cancellation
 * @returns {Promise<Object>} Processing result with success, metrics, markdown, images
 */
export async function processDocument(doc, abortSignal) {
  logger.info('Processing document', { docId: doc.id, filename: doc.filename });

  // Build pipeline configuration with document-specific data
  const pipelineDef = getExtractPipelineDefinition();
  
  // Populate stage data with document info
  pipelineDef.stages.forEach(stage => {
    stage.data = {
      doc_id: doc.id,
      source_path: doc.source_path,
      filename: doc.filename || doc.doc_filename
    };
  });
  
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

/**
 * Get stage names for the extract pipeline
 * Reflects the current config's enabled stages.
 */
export function getStageNames() {
  const names = ['extract'];
  if (config.document_denoise.enabled) names.push('denoise');
  if (config.document_denoise_llm.enabled) names.push('denoise-llm');
  if (config.diagram_description.enabled) names.push('vision');
  return names;
}
