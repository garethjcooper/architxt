/**
 * Extract Repository Stage
 *
 * I/O stage for repository documents: sends the repo path (doc.source_path)
 * to gitdiagram-serve, which analyzes the repo with an LLM and returns an
 * architecture diagram (Mermaid) plus an evidence-based explanation.
 *
 * Emits the same artifacts as the standard extract stage plus a structured
 * envelope:
 *   - document-md: explanation + Mermaid diagram report
 *   - document-images: empty array (repository analysis produces no images)
 *   - document-envelope: standard contextual-graph envelope
 *     (narratives + graph + tables + diagrams) built from the service result
 *
 * Relationship/entity extraction is intentionally not performed here — the
 * pipeline contract is unchanged from the trace stage.
 */

import { createLogger } from '../../utils/logger.js';
import { analyzeRepository } from '../../services/gitdiagram/client.js';

const logger = createLogger('stage-extract-repository');

function buildMarkdown(result) {
  const explanation = result.explanation || '';
  const mermaid = result.mermaid || '';
  return [
    '# Repository Architecture Analysis',
    '',
    `**Repository:** \`${result.repo?.path ?? ''}\``,
    `**HEAD:** \`${result.repo?.head ?? ''}\` (${result.repo?.branch ?? ''})`,
    '',
    '## Explanation',
    '',
    explanation,
    '',
    '## Architecture Diagram (Mermaid)',
    '',
    '```mermaid',
    mermaid,
    '```',
    '',
  ].join('\n');
}

/**
 * Map gitdiagram-serve's result onto the standard contextual-graph envelope
 * (narratives + graph + tables + diagrams) so repository analysis can feed
 * the same UI/consumers as Hindsight reflect output.
 */
function buildEnvelope(result) {
  const repoName = result.repo?.remoteUri || result.repo?.path || 'repository';
  const explanation = result.explanation || '';
  const nodes = (result.graph?.nodes || []).map((n) => ({
    id: n.id,
    label: n.label,
    path: n.path ?? null,
    group: n.group ?? null,
  }));
  const edges = (result.graph?.edges || []).map((e) => ({
    from: e.from,
    to: e.to,
    type: e.dashed ? 'inferred' : 'depends-on',
    label: e.label || '',
    detail: e.evidencePath ? `evidence: ${e.evidencePath}` : '',
    evidence: e.evidencePath ? [e.evidencePath] : [],
  }));
  return {
    narratives: [
      {
        narrative_name: 'Repository architecture',
        narrative: explanation,
        evidence: nodes.filter((n) => n.path).map((n) => n.path),
      },
    ],
    graph: { name: String(repoName), nodes, edges },
    tables: [],
    diagrams: [
      {
        name: 'Architecture diagram',
        type: 'mermaid',
        content: result.mermaid || '',
        evidence: [],
      },
    ],
  };
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
    const options = {
      ...(data.doc_processing_options?.maxSourceFiles ? { maxSourceFiles: data.doc_processing_options.maxSourceFiles } : {}),
      ...(data.doc_processing_options?.maxSourceChars ? { maxSourceChars: data.doc_processing_options.maxSourceChars } : {}),
      ...(data.doc_processing_options?.model ? { model: data.doc_processing_options.model } : {}),
    };

    logger.info('Repository analysis starting', { docId, repoUri, serviceUrl: stageOptions.serviceUrl });

    const result = await analyzeRepository(repoUri, options, context?.abortSignal);

    const markdown = buildMarkdown(result);
    const envelope = buildEnvelope(result);
    const durationMs = Date.now() - startTime;

    logger.info('Repository analysis complete', {
      docId,
      repoUri,
      durationMs,
      markdownLength: markdown.length,
      nodes: result.graph?.nodes?.length ?? 0,
      edges: result.graph?.edges?.length ?? 0,
      promptTokens: result.usage?.promptTokens ?? 0,
      completionTokens: result.usage?.completionTokens ?? 0,
    });

    return {
      stageOutput: [
        { name: 'document-md', data: markdown, type: 'string' },
        { name: 'document-images', data: [], type: 'array' },
        { name: 'document-envelope', data: envelope, type: 'object' },
      ],
      stageMetrics: {
        durationMs,
        repoUri,
        nodes: result.graph?.nodes?.length ?? 0,
        edges: result.graph?.edges?.length ?? 0,
        markdownLength: markdown.length,
        promptTokens: result.usage?.promptTokens ?? 0,
        completionTokens: result.usage?.completionTokens ?? 0,
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

export { execute, validate, buildMarkdown, buildEnvelope };
