import { toast } from 'sonner';
import { researchApi, type ResearchStepSummary } from './client';

const POLL_INTERVAL_MS = 1500;
const MAX_POLL_MS = 10 * 60 * 1000;

export interface PollForStepCompletionOptions {
  maxMs?: number;
  intervalMs?: number;
  /** Called on every poll tick with the latest steps, so callers can refresh their trail/session state. */
  onPoll?: (steps: ResearchStepSummary[]) => void | Promise<void>;
}

export async function pollForStepCompletion(
  sessionId: number,
  stepId: number,
  options: PollForStepCompletionOptions = {},
): Promise<ResearchStepSummary | null> {
  const { maxMs = MAX_POLL_MS, intervalMs = POLL_INTERVAL_MS, onPoll } = options;
  const start = Date.now();

  while (Date.now() - start < maxMs) {
    const steps = await researchApi.getSessionSteps(sessionId);
    const step = steps.find((s) => s.id === stepId);

    if (!step) {
      await new Promise((resolve) => setTimeout(resolve, intervalMs));
      continue;
    }

    await onPoll?.(steps);

    if (step.status === 'completed') {
      if (step.error_message) {
        toast.warning(`Research completed with warnings: ${step.error_message}`);
      }
      return step;
    }

    if (step.status === 'failed') {
      const message = step.error_message || 'Research step failed';
      toast.error(`Research failed: ${message}`);
      return step;
    }

    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }

  toast.error('Research step timed out');
  return null;
}
