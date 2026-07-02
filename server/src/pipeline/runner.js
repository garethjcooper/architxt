/**
 * Pipeline Runner (v3 Pattern - Adapted for architxt)
 * 
 * Core concepts:
 * - Runner receives finalPipeline from buildPipeline (pre-resolved)
 * - Seed output pre-populates provenance log at index -1
 * - All stages resolve inputs from provenance log via resolvedInputs
 * - Provenance log returned for full traceability
 * - Stage signature: execute(artifacts, config, data, services, context)
 *   - context contains: { abortSignal }
 * - Stage return: { stageResult, stageMetrics, stageOutput }
 * 
 * Progress reporting via optional reporter interface - no coupling to DB or HTTP
 */

import { createLogger } from '../utils/logger.js';

const logger = createLogger('pipeline-runner');

function summarizeProvenanceLog(provenanceLog) {
  return JSON.stringify(
    provenanceLog.map(entry => ({
      index: entry.index,
      name: entry.name,
      itemCount: entry.items?.length || 0
    })),
    null,
    2
  );
}

/**
 * ProgressReporter interface (injected by caller - no coupling inside runner)
 * 
 * @typedef {Object} ProgressReporter
 * @property {function} onPipelineStart - Called when pipeline starts
 * @property {function} onStageStart - Called when each stage starts
 * @property {function} onStageComplete - Called when each stage completes
 * @property {function} onPipelineComplete - Called when pipeline finishes (success or failure)
 * @property {function} onError - Called on stage/pipeline error
 */

/**
 * Create pipeline runner
 * 
 * The runner is a pure executor using provenance-log architecture.
 * Receives finalPipeline from buildPipeline with resolvedInputs.
 * 
 * @param {Object} options - Runner options: { reporter, signal }
 * @returns {Object} Runner with execute method
 */
export function createRunner(options = {}) {
  const { reporter } = options;

  return {
    /**
     * Execute pipeline
     * 
     * @param {Object} finalPipeline - Pipeline from buildPipeline with resolvedInputs
     * @param {Object} seedOutput - Initial artifacts for stage -1: { [name]: data }
     * @param {Object} options - Execution options: { signal }
     * @returns {Promise<{success: boolean, results: Object[], provenanceLog: Object[]}>} 
     */
    async execute(finalPipeline, seedOutput, options) {
      const { signal } = options;
      const results = [];
      const errors = [];

      const provenanceLog = [];

      // Helper: skip reporter calls after abort to avoid API noise (e.g. 409 on request_release)
      const reportIfActive = (method, ...args) => {
        if (!signal?.aborted && reporter?.[method]) {
          try {
            const maybePromise = reporter[method](...args);
            if (maybePromise && typeof maybePromise.catch === 'function') {
              maybePromise.catch((err) => {
                logger.warn('Reporter call failed; continuing pipeline', { method, error: err.message });
              });
            }
          } catch (err) {
            logger.warn('Reporter call threw; continuing pipeline', { method, error: err.message });
          }
        }
      };

      // Seed stage: pre-populate at index -1
      if (Object.keys(seedOutput).length > 0) {
        provenanceLog.push({
          index: -1,
          name: 'seed',
          items: Object.entries(seedOutput).map(([name, data]) => ({ name, data }))
        });

        logger.debug('Seed stage populated', {
          items: Object.keys(seedOutput)
        });
      }

      const stages = finalPipeline.stages.filter(s => s.index !== -1);

      // Report pipeline start
      reportIfActive('onPipelineStart');

      logger.info('Pipeline starting', {
        name: finalPipeline.name,
        stages: stages.length
      });

      for (const stage of stages) {
        if (signal?.aborted) {
          const result = {
            success: false,
            results,
            errors: [...errors, 'Pipeline cancelled'],
            provenanceLog
          };
          reportIfActive('onPipelineComplete', result);
          return result;
        }

        // Report stage start
        reportIfActive('onStageStart', stage);

        try {
          const artifacts = {};
          for (const [inputName, resolution] of Object.entries(stage.resolvedInputs || {})) {
            logger.debug('Resolving input for stage ' + stage.index + ' (' + stage.name + '), provenance log: ' + summarizeProvenanceLog(provenanceLog));

            const sourceStage = provenanceLog.find(s => s.index === resolution.fromStage);
            if (!sourceStage) {
              throw new Error(`Stage ${stage.name}: Cannot resolve input '${inputName}' - source stage ${resolution.fromStage} not found`);
            }
            const item = sourceStage.items.find(i => i.name === resolution.artifact);
            if (!item) {
              throw new Error(`Stage ${stage.name}: Cannot resolve input '${inputName}' - artifact '${resolution.artifact}' not found in stage ${resolution.fromStage}`);
            }
            artifacts[inputName] = item.data;
          }

          logger.info('Stage starting', {
            stage: stage.name,
            index: stage.index,
            inputs: Object.keys(artifacts)
          });
          
          // Don't log full config objects - they may contain large prompts
          // logger.debug('Stage config', { config: stageConfig }); // Skipped - config may be large
          // logger.debug('Stage data', { data: stageData }); // Skipped - may contain sensitive data

          const startTime = Date.now();

          /**
           * Execute stage function with cancellation context
           */
          let result;
          const executeFn = stage.execute;
          const stageConfig = stage.config || {};
          const stageData = stage.data || {};
          const stageServices = stage.services || {};
          const stageContext = {
            abortSignal: signal,
            emit: (event, data) => {
              if (event === 'progress' && !signal?.aborted) {
                reporter?.onSubProgress?.(stage, data);
              }
            }
          };

          if (stage.timeoutMs) {
            result = await Promise.race([
              executeFn(artifacts, stageConfig, stageData, stageServices, stageContext),
              new Promise((_, reject) =>
                setTimeout(() => reject(new Error(`Stage timeout: ${stage.name}`)), stage.timeoutMs)
              )
            ]);
          } else {
            result = await executeFn(artifacts, stageConfig, stageData, stageServices, stageContext);
          }

          const durationMs = Date.now() - startTime;

          if (!result?.stageResult) {
            throw new Error(`Stage ${stage.name}: Invalid result - missing stageResult`);
          }
          if (!result?.stageOutput) {
            throw new Error(`Stage ${stage.name}: Invalid result - missing stageOutput`);
          }

          provenanceLog.push({
            index: stage.index,
            name: stage.name,
            items: result.stageOutput
          });

          const stageResult = {
            stage: stage.name,
            index: stage.index,
            success: result.stageResult.success,
            error: result.stageResult.error,
            metrics: result.stageMetrics || { durationMs }
          };
          results.push(stageResult);

          // Report stage completion
          reportIfActive('onStageComplete', stage, {
            result: stageResult,
            output: result.stageOutput
          });

          if (!result.stageResult.success && !stage.optional) {
            const error = result.stageResult.error || `Stage ${stage.name} failed`;
            logger.error('Stage failed', { stage: stage.name, error });
            errors.push(`${stage.name}: ${error}`);
            const finalResult = { success: false, results, errors, provenanceLog };
            reportIfActive('onPipelineComplete', finalResult);
            return finalResult;
          }

          logger.info('Stage complete', {
            stage: stage.name,
            durationMs,
            outputs: result.stageOutput.map(o => o.name)
          });

        } catch (error) {
          // Distinguish cancellation from real failures
          const isCancel = signal?.aborted || error?.name === 'AbortError' || error?.message?.toLowerCase().includes('cancel');
          if (isCancel) {
            logger.info('Stage cancelled', { stage: stage.name, reason: error.message || 'abort signal' });
          } else {
            logger.error('Stage error', { stage: stage.name, error: error.message });
          }

          reportIfActive('onError', error, stage);

          if (!stage.optional) {
            errors.push(`${stage.name}: ${error.message || 'cancelled'}`);
            const finalResult = { success: false, results, errors, provenanceLog };
            reportIfActive('onPipelineComplete', finalResult);
            return finalResult;
          }
        }
      }

      logger.info('Pipeline complete', {
        name: finalPipeline.name,
        stages: results.length
      });

      const finalResult = { success: true, results, provenanceLog };
      reportIfActive('onPipelineComplete', finalResult);
      return finalResult;
    }
  };
}
