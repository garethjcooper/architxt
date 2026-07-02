import { createLogger } from '../utils/logger.js';
import { config } from '../config.js';
import {
  pollForWork,
  claimDocument,
  getDocument,
  reportExtracted,
  getOrphanedDocuments,
  releaseDocument
} from './extract/api-client.js';
import { processDocument } from './extract/pipeline-runner.js';

const logger = createLogger('extract-daemon');

// Configuration
const POLL_INTERVAL_MS = config.extractdaemon.poll_interval_ms;
const ORPHAN_THRESHOLD_MINUTES = config.extractdaemon.orphan_threshold_minutes;

// Daemon state
let isRunning = false;
let currentDocId = null;
let currentAbortController = null;

// Reconciliation runs every N iterations (deterministic)
let loopCounter = 0;
const RECONCILE_EVERY_N_LOOPS = 10;

/**
 * Sleep utility
 */
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Reconcile orphaned documents
 * Documents stuck in processing_extract for too long are likely from crashed daemons.
 * Returns count of documents reset to uploaded.
 */
async function reconcileOrphans() {
  const ORPHAN_THRESHOLD_MS = ORPHAN_THRESHOLD_MINUTES * 60 * 1000;

  try {
    const orphans = await getOrphanedDocuments();
    let resetCount = 0;

    for (const docId of orphans) {
      logger.warn('Reconciling orphaned document', { docId });

      const released = await releaseDocument(
        docId,
        'reconciliation',
        { orphanedMs: ORPHAN_THRESHOLD_MS }
      );

      if (released) {
        resetCount++;
        logger.info('Orphaned document reset', { docId });
      } else {
        logger.error('Failed to reset orphaned document', { docId });
      }
    }

    if (resetCount > 0) {
      logger.info('Reconciliation complete', { resetCount });
    }

    return resetCount;
  } catch (error) {
    logger.error('Reconciliation failed', { error: error.message });
    return 0;
  }
}

/**
 * Poll for cancellation request while processing.
 * If the document status changes to 'request_release', abort the pipeline.
 */
function startCancelPoll(docId, abortController) {
  const interval = setInterval(async () => {
    try {
      const doc = await getDocument(docId);
      if (doc?.status === 'request_release') {
        logger.info('Cancellation requested, aborting pipeline', { docId });
        abortController.abort();
      }
    } catch (err) {
      // Best-effort: ignore poll errors
      logger.debug('Cancel poll error', { docId, error: err.message });
    }
  }, 5000); // Check every 5 seconds

  return {
    stop: () => clearInterval(interval)
  };
}

/**
 * Single daemon iteration
 */
async function processNext() {
  let cancelPoll = null;
  try {
    // Step 1: Poll for work (get candidate docId, no state change)
    const docId = await pollForWork();

    if (!docId) {
      logger.debug('No documents ready for processing');
      return false;
    }

    currentDocId = docId;

    // Step 2: Attempt atomic claim (fails if another daemon got it)
    const claimed = await claimDocument(docId);
    if (!claimed) {
      // Another daemon claimed it or state changed — drop it and poll again next cycle
      currentDocId = null;
      return false;
    }

    // Step 3: Get document details for processing
    const doc = await getDocument(docId);
    if (!doc) {
      logger.error('Failed to fetch claimed document details', { docId });
      currentDocId = null;
      return false;
    }

    // Step 4: Process the document (with abort support + cancel polling)
    const abortController = new AbortController();
    currentAbortController = abortController;
    cancelPoll = startCancelPoll(docId, abortController);
    const processResult = await processDocument(doc, abortController.signal);
    cancelPoll.stop();
    cancelPoll = null;
    currentAbortController = null;

    // Step 5: Check current document status before reporting
    // The user may have clicked "Release" while the pipeline was running.
    // If so, release back to uploaded and discard the result.
    const latestDoc = await getDocument(docId);
    const currentStatus = latestDoc?.status;

    if (currentStatus === 'request_release') {
      logger.info('Releasing document after user cancellation', { docId, pipelineSuccess: processResult.success });
      const released = await releaseDocument(docId, 'user cancelled', {});
      if (!released) {
        logger.error('Failed to release cancelled document', { docId });
      }
      currentDocId = null;
      return true;
    }

    if (currentStatus !== 'processing_extract') {
      logger.warn('Document in unexpected state after processing', { docId, currentStatus, pipelineSuccess: processResult.success });
      currentDocId = null;
      return true;
    }

    // Status is 'processing_extract' — if pipeline was aborted (shutdown),
    // leave it for reconciliation rather than reporting a result.
    if (!processResult.success && processResult.error?.toLowerCase().includes('cancel')) {
      logger.info('Pipeline aborted, leaving document for reconciliation', { docId });
      currentDocId = null;
      return true;
    }

    // Step 6: Report result (success or non-cancel failure)
    const reported = await reportExtracted(docId, processResult.success, {
      metrics: processResult.metrics,
      ...(processResult.success
        ? { markdown: processResult.markdown, images: processResult.images }
        : { error: processResult.error, errorDetails: processResult.errorDetails }
      )
    });

    if (!reported) {
      logger.warn('Failed to report extraction result', { docId });
    }

    currentDocId = null;
    return true;

  } catch (error) {
    if (cancelPoll) cancelPoll.stop();

    logger.error('Error in processNext', { error: error.message, stack: error.stack });

    if (currentDocId) {
      // If user cancelled while we were mid-process, release instead of reporting
      try {
        const latestDoc = await getDocument(currentDocId);
        if (latestDoc?.status === 'request_release') {
          await releaseDocument(currentDocId, 'user cancelled during processing', {});
          logger.info('Released document from catch block after user cancellation', { docId: currentDocId });
        } else if (latestDoc?.status === 'processing_extract') {
          // Preserve any structured stage errors we already collected before the exception
          await reportExtracted(currentDocId, false, {
            error: error.message,
            errorDetails: processResult?.errorDetails || []
          });
        } else {
          logger.warn('Document in unexpected state in catch block', { docId: currentDocId, status: latestDoc?.status });
        }
      } catch (innerErr) {
        logger.error('Failed to handle document in catch block', { docId: currentDocId, error: innerErr.message });
      }
      currentDocId = null;
    }

    return false;
  }
}

/**
 * Main daemon loop
 */
async function run() {
  logger.info('Extract daemon starting', { pollIntervalMs: POLL_INTERVAL_MS });
  isRunning = true;

  // Initial reconciliation on startup (handles previous daemon crash)
  logger.info('Running initial reconciliation');
  await reconcileOrphans();

  while (isRunning) {
    loopCounter++;

    // Periodic deterministic reconciliation
    if (loopCounter % RECONCILE_EVERY_N_LOOPS === 0) {
      await reconcileOrphans();
    }

    await processNext();

    // Always sleep between poll cycles, regardless of success or failure.
    // Prevents one daemon from monopolizing the queue in a tight loop
    // when jobs are small/fast, and reduces thundering-herd pressure.
    await sleep(POLL_INTERVAL_MS);
  }

  logger.info('Extract daemon stopped');
}

/**
 * Graceful shutdown
 */
function shutdown(signal) {
  logger.info(`Received ${signal}, shutting down gracefully`);
  isRunning = false;

  if (currentAbortController) {
    logger.info('Aborting current pipeline', { docId: currentDocId });
    currentAbortController.abort();
  } else if (currentDocId) {
    logger.warn('Daemon shutting down while processing document (no abort controller)', { docId: currentDocId });
    // Note: Document remains in 'processing_extract' state
    // Recovery is via reconciliation or timeout/retry mechanism
  }
}

// Signal handlers
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

// If the parent process dies, the IPC channel closes — exit immediately
process.on('disconnect', () => {
  logger.warn('IPC parent disconnected (parent process died), exiting');
  process.exit(1);
});

// Start the daemon
run().catch(error => {
  logger.error('Daemon crashed', { error: error.message, stack: error.stack });
  process.exit(1);
});
