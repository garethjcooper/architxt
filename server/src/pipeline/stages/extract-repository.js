/**
 * Extract Repository Stage
 *
 * I/O stage for repository documents: sends the repo path (doc.source_path)
 * to gitdiagram-serve, which analyzes the repo with an LLM and returns an
 * architecture diagram (Mermaid), the structured dependency graph, and an
 * evidence-based explanation.
 *
 * Emits the same artifacts as the standard extract stage:
 *   - document-md: the explanation in markdown, followed by the Mermaid diagram
 *   - document-images: empty array (repository analysis produces no images)
 *
 * Relationship/entity extraction is intentionally not performed here — the
 * pipeline contract is unchanged from the trace stage.
 */

import { createLogger } from '../../utils/logger.js';
import { analyzeRepository } from '../../services/gitdiagram/client.js';

const logger = createLogger('stage-extract-repository');

/**
 * Build the document markdown from a gitdiagram-serve result:
 * explanation prose + Mermaid diagram. The graph itself is not returned
 * by the service; all relationship detail is covered by the explanation.
 */
function buildMarkdown(result) {
  const parts = [];
  const explanation = typeof result.explanation === 'string' ? result.explanation : (result.explanation?.text || '');
  if (explanation) parts.push(explanation.trim());
  if (result.mermaid) parts.push('```mermaid\n' + result.mermaid.trim() + '\n```');
  return parts.join('\n\n');
}
async function execute(artifacts, _config, data, services, context) {
  const startTime = Date.now();
  const docId = data.doc_id;

  try {
    if (context?.abortSignal?.aborted) {
      throw new Error('Repository analysis cancelled before request');
    }

    const repoUri = data.doc_processing_options?.repo_uri || data.source_path;
    if (!repoUri || repoUri === 'UPLOADING') {
      throw new Error('Repository document missing repo_uri (doc_processing_options.repo_uri or source_path)');
    }

    const stageOptions = _config?.extract_repository || _config?.gitdiagram || {};
    // Per-document overrides live in doc_processing_options.gitdiagram; blank or
    // absent fields are omitted so gitdiagram-serve env defaults apply.
    const gds = data.doc_processing_options?.gitdiagram || {};
    const num = (v) => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : undefined);
    const options = {
      // legacy flat fields act as fallback only
      ...(data.doc_processing_options?.maxSourceFiles ? { maxSourceFiles: data.doc_processing_options.maxSourceFiles } : {}),
      ...(data.doc_processing_options?.maxSourceChars ? { maxSourceChars: data.doc_processing_options.maxSourceChars } : {}),
      ...(data.doc_processing_options?.model ? { model: data.doc_processing_options.model } : {}),
      // nested per-document block wins when set
      ...(num(gds.maxSourceFiles) ? { maxSourceFiles: gds.maxSourceFiles } : {}),
      ...(num(gds.maxSourceChars) ? { maxSourceChars: gds.maxSourceChars } : {}),
      ...(num(gds.maxSourceFileBytes) ? { maxSourceFileBytes: gds.maxSourceFileBytes } : {}),
      ...(num(gds.maxFactFiles) ? { maxFactFiles: gds.maxFactFiles } : {}),
      ...(num(gds.maxFactHeadBytes) ? { maxFactHeadBytes: gds.maxFactHeadBytes } : {}),
      ...(typeof gds.model === 'string' && gds.model.trim() ? { model: gds.model.trim() } : {}),
    };

    logger.info('Repository analysis starting', { docId, repoUri, serviceUrl: stageOptions.serviceUrl });

    const result = await analyzeRepository(repoUri, options, context?.abortSignal);

    const markdown = buildMarkdown(result);
    const durationMs = Date.now() - startTime;

    logger.info('Repository analysis complete', {
      docId,
      repoUri,
      durationMs,
      markdownLength: markdown.length,
      nodes: result.graphStats?.nodes ?? 0,
      edges: result.graphStats?.edges ?? 0,
      promptTokens: result.usage?.promptTokens ?? 0,
      completionTokens: result.usage?.completionTokens ?? 0,
    });

    return {
      stageOutput: [
        { name: 'document-md', data: markdown, type: 'string' },
        { name: 'document-images', data: [], type: 'array' },
      ],
      stageMetrics: {
        durationMs,
        repoUri,
        nodes: result.graphStats?.nodes ?? 0,
        edges: result.graphStats?.edges ?? 0,
        markdownLength: markdown.length,
        promptTokens: result.usage?.promptTokens ?? 0,
        completionTokens: result.usage?.completionTokens ?? 0,
        ...(result.repo?.commitDate ? { repoCommitDate: result.repo.commitDate } : {}),
        ...(result.repo?.authors?.length ? { repoAuthors: result.repo.authors } : {}),
      },
      stageResult: { success: true },
    };
  } catch (error) {
    logger.error('Repository analysis failed', { docId, error: error.message });
    return {
      stageResult: { success: false, error: `Repository analysis failed: ${error.message}` },
      stageMetrics: { durationMs: Date.now() - startTime, error: error.message },
      stageOutput: [],
    };
  }
}

function validate(config) {
  const errors = [];
  if (!config || typeof config !== 'object') {
    errors.push('config object is required');
  }
  return { valid: errors.length === 0, errors };
}

export { execute, validate, buildMarkdown };
