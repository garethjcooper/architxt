import { createParserForProfile, isEnginePayloadModule } from './parser-registry.js';
import { mineSequences } from './sequence-miner.js';
import { applyFieldExtractionToRecords } from './trace-field-extract.js';
import { chunkSource } from './chunker.js';
import { config } from '../../config.js';

/**
 * Transform a trace document source file using the supplied profile.
 *
 * Pure-function wrapper over the trace parser engines — no I/O here; callers
 * (the extract-trace pipeline stage, profile routes) decide persistence.
 *
 * Large inputs (above traceExtract.chunk_threshold_bytes) are parsed in
 * record-boundary-aware chunks to bound peak memory. Chunking applies to
 * parse + size-cap + field extraction only: extracted rows are accumulated
 * and sequence mining still runs ONCE over the combined rows, so correlation
 * groups are never split across chunks.
 *
 * Returns `markdown`: a pipe-delimited cleaned-log rendering of the parsed
 * rows (capped at traceExtract.max_output_chars with a truncation marker), plus
 * `records`, `metrics`, and an optional `sequenceDocument` when the profile
 * has a sequenceProfile.
 *
 * @param {object} profile - Trace profile row (tfp_config).
 * @param {Buffer|string} content - Raw source file content.
 * @param {string} [filename]
 * @param {object} [options]
 * @param {AbortSignal} [options.abortSignal] - checked between chunks.
 * @returns {Promise<{ records: object[], markdown: string, metrics: object, sequenceDocument?: { markdown: string, stats: object } }>}
 */
export async function processTraceContent(profile, content, filename = null, options = {}) {
  const parserConfig = profile?.tfp_config || {};
  const parser = createParserForProfile(profile);
  const abortSignal = options.abortSignal;

  const text = Buffer.isBuffer(content) ? content.toString('utf-8') : String(content);
  const threshold = config.traceExtract?.chunk_threshold_bytes ?? 0;
  const chunkSize = config.traceExtract?.chunk_size ?? 5000;

  let records;
  let chunkCount = 1;
  if (threshold > 0 && Buffer.byteLength(text) > threshold) {
    // Chunked path: parse each record-boundary-aware chunk separately and
    // accumulate records. Abort checks between chunks make a stage timeout
    // cooperative — the runner's Promise.race alone can't stop the work.
    const { chunks } = chunkSource(parserConfig, text, { chunkBy: 'records', chunkSize });
    chunkCount = chunks.length;
    const all = [];
    for (const chunk of chunks) {
      if (abortSignal?.aborted) throw new Error('Trace extraction cancelled during chunked parse');
      const parsed = await parser.parseFile('chunk', chunk.content);
      all.push(...parsed);
    }
    records = all;
  } else {
    records = await parser.parseFile(filename || 'trace-source', content);
  }

  const { records: cappedRecords, oversizedCount } = parser.applyRecordSizeCap(records);

  const metrics = {
    rawFiles: 1,
    rawRecords: cappedRecords.length,
    parsedRecords: cappedRecords.filter((r) => !r.unparsed).length,
    unparsedCount: cappedRecords.filter((r) => r.unparsed).length,
    oversizedCount,
    chunkCount,
  };

  const markdown = buildCleanedLogMarkdown(cappedRecords, metrics, filename || 'trace-source');

  const result = {
    records: cappedRecords,
    markdown,
    metrics,
  };

  const sequenceProfile = parserConfig?.parser?.config?.sequenceProfile;
  if (sequenceProfile && cappedRecords.length > 0) {
    const parsedRecords = applyFieldExtractionToRecords(
      cappedRecords.filter((r) => !r.unparsed),
      parserConfig?.fieldExtraction,
      { enginePayload: isEnginePayloadModule(parserConfig?.parser?.module) }
    );
    const inputFormat = parserConfig?.parser?.module || 'trace';
    result.sequenceDocument = mineSequences(parsedRecords, sequenceProfile, {
      filename: filename || 'trace-source',
      inputFormat,
    });
  }

  return result;
}

const MAX_OUTPUT_CHARS = () => config.traceExtract?.max_output_chars ?? 10 * 1024 * 1024;
const OUTPUT_HEAD_LINES = 20;

/**
 * Render parsed records as a pipe-delimited cleaned-log markdown document.
 * Only the first OUTPUT_HEAD_LINES rows are inlined; the rest are summarised,
 * and the whole document is hard-capped at max_output_chars (truncated with a
 * marker) so the stage result stays well under express.json's 50mb limit.
 */
function buildCleanedLogMarkdown(records, metrics, filename) {
  const parsed = records.filter((r) => !r.unparsed);
  const lines = parsed.map((r) => String(r.raw));
  const head = lines.slice(0, OUTPUT_HEAD_LINES).join('\n');
  const omitted = lines.length - OUTPUT_HEAD_LINES;
  const omittedText = omitted > 0 ? `\n\n... (${omitted} more lines) ...` : '';
  let markdown = `# Cleaned Trace Log: ${filename}\n\n`
    + `- Records: ${metrics.parsedRecords} parsed, ${metrics.unparsedCount} unparsed`
    + (metrics.oversizedCount ? `, ${metrics.oversizedCount} oversized` : '')
    + (metrics.chunkCount > 1 ? `, ${metrics.chunkCount} chunks` : '')
    + `\n- Format: pipe-delimited standard log\n\n\`\`\`delimited\n${head}${omittedText}\n\`\`\`\n`;

  const cap = MAX_OUTPUT_CHARS();
  if (cap > 0 && markdown.length > cap) {
    markdown = markdown.slice(0, cap) + `\n\n... (output truncated at ${cap} chars) ...\n`;
  }
  return markdown;
}

export { createParserForProfile } from './parser-registry.js';
