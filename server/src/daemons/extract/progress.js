import { createLogger } from '../../utils/logger.js';
import { reportProgress } from './api-client.js';

const logger = createLogger('extract-daemon-progress');

const MAX_TIMELINE_EVENTS = 20;

/**
 * Progress reporter - updates progress via API (not direct DB)
 * Daemon uses API exclusively for all state changes
 * 
 * @param {number} docId - Document ID being processed
 * @param {Array} stages - Stage definitions from registry
 * @returns {Object} Progress reporter with lifecycle callbacks
 */
export function createProgressReporter(docId, stages) {
  const now = new Date().toISOString();
  
  // Simple in-memory progress state (no DB reads)
  let progressState = {
    pipeline: stages.map(s => s.name),
    current_step: 0,
    started_at: now,
    updated_at: now,
    stages: stages.reduce((acc, s) => {
      acc[s.name] = { status: 'pending' };
      return acc;
    }, {})
  };

  const updateTimestamp = () => {
    progressState.updated_at = new Date().toISOString();
  };

  const updateItemAggregates = (stageName, info) => {
    const stage = progressState.stages[stageName];
    if (!stage._itemStats) {
      stage._itemStats = { count: 0, totalDurationMs: 0, minDurationMs: Infinity, maxDurationMs: 0, totalTokens: 0 };
    }
    const stats = stage._itemStats;
    stats.count += 1;
    if (info.durationMs != null) {
      stats.totalDurationMs += info.durationMs;
      stats.minDurationMs = Math.min(stats.minDurationMs, info.durationMs);
      stats.maxDurationMs = Math.max(stats.maxDurationMs, info.durationMs);
    }
    if (info.tokens != null) {
      stats.totalTokens += info.tokens;
    }
  };

  const getItemAggregates = (stageName) => {
    const stats = progressState.stages[stageName]?._itemStats;
    if (!stats || stats.count === 0) return null;
    return {
      avgDurationMs: Math.round(stats.totalDurationMs / stats.count),
      minDurationMs: stats.minDurationMs === Infinity ? null : stats.minDurationMs,
      maxDurationMs: stats.maxDurationMs,
      totalItems: stats.count,
      totalTokens: stats.totalTokens || undefined
    };
  };

  const appendTimeline = (stageName, event) => {
    const stage = progressState.stages[stageName];
    if (!stage.timeline) stage.timeline = [];
    if (stage.timeline.length < MAX_TIMELINE_EVENTS) {
      stage.timeline.push({
        at: new Date().toISOString(),
        ...event
      });
    }
  };

  return {
    onPipelineStart: async () => {
      updateTimestamp();
      await reportProgress(docId, progressState);
    },

    onStageStart: async (stage) => {
      progressState.stages[stage.name] = {
        ...progressState.stages[stage.name],
        status: 'running',
        started_at: new Date().toISOString()
      };
      progressState.current_step = stages.findIndex(s => s.name === stage.name);
      progressState.current_stage = stage.name;
      updateTimestamp();

      await reportProgress(docId, progressState);
    },

    onStageComplete: async (stage, { result }) => {
      const aggregates = getItemAggregates(stage.name);
      progressState.stages[stage.name] = {
        ...progressState.stages[stage.name],
        status: result.success ? 'completed' : 'failed',
        completed_at: new Date().toISOString(),
        metrics: {
          ...result.metrics,
          ...(aggregates || {})
        }
      };
      updateTimestamp();

      await reportProgress(docId, progressState);

      logger.info('Stage complete', {
        stage: stage.name,
        docId,
        success: result.success,
        ...(aggregates || {})
      });
    },

    onSubProgress: async (stage, info) => {
      // Accumulate capped timeline
      appendTimeline(stage.name, info);

      // Update running aggregates for item_complete events
      if (info.event === 'item_complete') {
        updateItemAggregates(stage.name, info);
      }

      // Update live sub_progress and running metrics
      const runningAggregates = info.event === 'item_complete' ? getItemAggregates(stage.name) : null;
      progressState.stages[stage.name] = {
        ...progressState.stages[stage.name],
        sub_progress: info,
        ...(runningAggregates && {
          metrics: {
            ...(progressState.stages[stage.name]?.metrics || {}),
            ...runningAggregates
          }
        })
      };
      updateTimestamp();
      await reportProgress(docId, progressState);

      logger.debug('Sub-progress', {
        stage: stage.name,
        docId,
        ...info
      });
    },

    onError: async (error, stage) => {
      progressState.stages[stage.name] = {
        ...progressState.stages[stage.name],
        status: 'failed',
        error: error.message
      };
      updateTimestamp();

      await reportProgress(docId, progressState);
    },

    getState: () => {
      // Return clean snapshot without internal _itemStats
      return JSON.parse(JSON.stringify(
        Object.entries(progressState.stages).reduce((acc, [name, stage]) => {
          const { _itemStats, ...rest } = stage;
          acc[name] = rest;
          return acc;
        }, { ...progressState, stages: undefined })
      ));
    },

    onPipelineComplete: async (result) => {
      updateTimestamp();
      
      // Progress stays in DB until /extracted moves it to history
      logger.info('Pipeline complete', { docId, success: result.success });
    }
  };
}

/**
 * Get current progress state (for testing/debugging)
 * Not exported by default, can be added if needed
 */
export function getProgressSnapshot(reporter) {
  // Access internal state would require exposing it
  // For now this is just a placeholder showing the pattern
  return null;
}
