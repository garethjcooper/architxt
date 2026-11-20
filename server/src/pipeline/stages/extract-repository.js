/**
 * Extract Repository Stage
 *
 * I/O stage for repository documents: sends the repo path (doc.source_path)
 * to gitdiagram-serve, which analyzes the repo with an LLM and returns an
 * architecture diagram (Mermaid), the structured dependency graph, and an
 * evidence-based explanation.
 *
 * Emits the same artifacts as the standard extract stage:
 *   - document-md: the explanation in markdown, followed by the Mermaid
 *     diagram and the graph as a fenced ```json block
 *   - document-images: empty array (repository analysis produces no images)
 *
 * Relationship/entity extraction is intentionally not performed here — the
 * pipeline contract is unchanged from the trace stage.
 */

import { createLogger } from '../../utils/logger.js';
import { analyzeRepository } from '../../services/gitdiagram/client.js';

const logger = createLogger('stage-extract-repository');

/**
 * architxt standard edge types (see prompts/normalize-graph.js
 * VALID_EDGE_TYPES). When gitdiagram-serve runs with
 * GITDIAGRAM_SERVE_EDGE_VOCABULARY=on, each graph edge `label` is one of
 * these verbs, so it can be promoted to `type` — matching architxt's edge
 * shape where `type` is the standardized kind and `label` is prose.
 */
const STANDARD_EDGE_TYPES = new Set(['calls', 'sends', 'reads', 'writes', 'depends-on']);

function promoteEdgeLabels(graph) {
  if (!graph || !Array.isArray(graph.edges)) return graph;
  return {
    ...graph,
    edges: graph.edges.map((e) => {
      const label = typeof e?.label === 'string' ? e.label.trim().toLowerCase() : '';
      if (label && STANDARD_EDGE_TYPES.has(label) && !e.type) {
        const { label: _label, ...rest } = e;
        return { ...rest, type: label, label: '' };
      }
      return e;
    }),
  };
}

/**
 * Build the document markdown from a gitdiagram-serve result:
 * explanation prose + Mermaid diagram + graph as a fenced JSON block.
 */
function buildMarkdown(result) {
  const parts = [];
  const explanation = typeof result.explanation === 'string' ? result.explanation : (result.explanation?.text || '');
  if (explanation) parts.push(explanation.trim());
  if (result.mermaid) parts.push('```mermaid\n' + result.mermaid.trim() + '\n```');
  const graph = promoteEdgeLabels(result.graph);
  if (graph && (graph.nodes?.length || graph.edges?.length)) {
    parts.push('```json\n' + JSON.stringify(graph, null, 2) + '\n```');
  }
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
    const options = {
      ...(data.doc_processing_options?.maxSourceFiles ? { maxSourceFiles: data.doc_processing_options.maxSourceFiles } : {}),
      ...(data.doc_processing_options?.maxSourceChars ? { maxSourceChars: data.doc_processing_options.maxSourceChars } : {}),
      ...(data.doc_processing_options?.model ? { model: data.doc_processing_options.model } : {}),
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
      nodes: result.graph?.nodes?.length ?? 0,
      edges: result.graph?.edges?.length ?? 0,
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
        nodes: result.graph?.nodes?.length ?? 0,
        edges: result.graph?.edges?.length ?? 0,
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
