/**
 * GitDiagram Service Client
 *
 * HTTP client for gitdiagram-serve (external Node service).
 * Sends a local repository path; the service analyzes it with an LLM and
 * returns an architecture diagram (Mermaid) plus an evidence-based explanation.
 *
 * Environment: GITDIAGRAM_SERVICE_URL=http://localhost:5002
 * API: POST /v1/analyze { repo, options? } -> { ok, repo, explanation, graph, mermaid, usage }
 */

import { createLogger } from '../../utils/logger.js';
import { config } from '../../config.js';

const logger = createLogger('gitdiagram-client');

const SERVICE_URL = () => config.gitdiagram?.serviceUrl || 'http://localhost:5002';
const TIMEOUT_MS = () => config.gitdiagram?.timeoutMs || 600_000;

/**
 * Analyze a local git repository via gitdiagram-serve.
 *
 * @param {string} repoUri - Local path, file:// URI, or remote git URI (the service clones remote URIs into its cache)
 * @param {Object} [options] - { maxSourceFiles, maxSourceChars, model }
 * @param {AbortSignal} [signal] - Optional AbortSignal to cancel the request
 * @returns {Promise<{repo: Object, explanation: string, graphStats: Object, mermaid: string, usage: Object}>}
 */
export async function analyzeRepository(repoUri, options = {}, signal = null) {
  if (!repoUri || typeof repoUri !== 'string') {
    throw new Error('repo (string) is required');
  }

  const url = `${SERVICE_URL()}/v1/analyze`;
  const startedAt = Date.now();

  const controller = new AbortController();
  const onAbort = () => controller.abort();
  if (signal) {
    if (signal.aborted) controller.abort();
    else signal.addEventListener('abort', onAbort, { once: true });
  }
  const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS());

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ repo: repoUri, options }),
      signal: controller.signal,
    });

    const data = await res.json().catch(() => ({}));

    if (!res.ok || data.ok === false) {
      const err = new Error(data.error || `gitdiagram-serve request failed (${res.status})`);
      err.status = res.ok ? 502 : res.status;
      throw err;
    }

    logger.info('Repository analyzed via gitdiagram-serve', {
      repo: repoUri,
      durationMs: Date.now() - startedAt,
      nodes: data.graphStats?.nodes ?? 0,
      edges: data.graphStats?.edges ?? 0,
      mermaidLength: data.mermaid?.length ?? 0,
    });

    return {
      repo: data.repo,
      explanation: typeof data.explanation === 'string' ? data.explanation : data.explanation?.text,
      graphStats: data.graphStats,
      mermaid: data.mermaid,
      usage: data.usage || {},
    };
  } catch (err) {
    if (err.name === 'AbortError') {
      throw new Error(`gitdiagram-serve request timed out or was aborted after ${TIMEOUT_MS()}ms`);
    }
    logger.error('gitdiagram-serve request failed', { repo: repoUri, error: err.message });
    throw err;
  } finally {
    clearTimeout(timeout);
    if (signal) signal.removeEventListener('abort', onAbort);
  }
}

/**
 * Lightweight health check against the service.
 * @returns {Promise<boolean>}
 */
export async function isServiceAvailable() {
  try {
    const res = await fetch(`${SERVICE_URL()}/health`, { signal: AbortSignal.timeout(5000) });
    return res.ok;
  } catch {
    return false;
  }
}
