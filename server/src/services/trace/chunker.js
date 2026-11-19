/**
 * Deterministic chunking for trace profile coverage loops.
 *
 * Splits a raw source string into chunks that can be fed back into the
 * registered parser engines. The chunker understands each engine's logical
 * record boundaries so that `chunkBy: 'records'` never splits a record.
 *
 * For delimited profiles with `input.hasHeader: true`, the header line is kept
 * inside the first chunk's content (so the parser can resolve column names) but
 * is excluded from `totalRecords` and from per-chunk record counts, because it
 * does not represent a data record.
 */

import { getRecordBoundaryDetector } from './parser-registry.js';
import { normalizeTraceConfigForChunker } from './parsers/base-parser.js';

const DEFAULT_CHUNK_SIZE = 50;
const MAX_CHUNK_SIZE = 10000;

/**
 * @typedef {object} ChunkRange
 * @property {number} startLine - 0-indexed inclusive start line.
 * @property {number} endLine - 0-indexed inclusive end line.
 */

/**
 * @typedef {object} SourceChunk
 * @property {number} chunkId
 * @property {ChunkRange} range
 * @property {number} totalRecords
 * @property {string} content
 */

/**
 * Split source content into chunks based on the profile's parser engine.
 *
 * @param {object} profileConfig - Trace profile config (parser.module + parser.config).
 * @param {string} content - Raw source content.
 * @param {object} [options]
 * @param {'records'|'lines'} [options.chunkBy='records']
 * @param {number} [options.chunkSize=50]
 * @returns {{ totalRecords: number, headerLine: string|null, chunks: SourceChunk[] }}
 */
export function chunkSource(profileConfig, content, options = {}) {
  const chunkBy = options.chunkBy || 'records';
  const chunkSize = clampChunkSize(options.chunkSize);
  const lines = splitLines(content);

  const records = chunkBy === 'records'
    ? detectRecords(profileConfig, lines)
    : lines.map((_, i) => ({ startLine: i, endLine: i }));

  const input = normalizeTraceConfigForChunker(profileConfig.parser?.config || {}).input || {};
  const hasHeader = input.hasHeader ?? false;
  const headerRange = hasHeader && records.length > 0 && records[0].startLine === 0
    ? records.shift()
    : null;
  const headerLine = headerRange ? lines[0] : null;

  const chunks = [];
  for (let i = 0; i < records.length; i += chunkSize) {
    const slice = records.slice(i, i + chunkSize);
    const startLine = slice[0].startLine;
    const endLine = slice[slice.length - 1].endLine;
    const contentLines = lines.slice(startLine, endLine + 1);
    if (headerLine && startLine > 0) {
      // Prepend header so the parser can resolve column names, without changing
      // the reported line range of the data itself.
      contentLines.unshift(headerLine);
    }
    chunks.push({
      chunkId: chunks.length,
      range: { startLine, endLine },
      totalRecords: slice.length,
      content: contentLines.join('\n'),
    });
  }

  return { totalRecords: records.length, headerLine, chunks };
}

function detectRecords(profileConfig, lines) {
  const moduleName = profileConfig?.parser?.module;
  const detector = getRecordBoundaryDetector(moduleName);
  const parserConfig = normalizeTraceConfigForChunker(profileConfig.parser?.config || {});
  if (detector) {
    return detector(lines, parserConfig);
  }
  // Unknown engine: fall back to one line per record.
  return lines.map((_, i) => ({ startLine: i, endLine: i }));
}

function splitLines(content) {
  if (typeof content !== 'string') return [];
  return content.split(/\r?\n/);
}

function clampChunkSize(raw) {
  const size = Number(raw) || DEFAULT_CHUNK_SIZE;
  if (!Number.isFinite(size) || size < 1) return DEFAULT_CHUNK_SIZE;
  return Math.min(size, MAX_CHUNK_SIZE);
}
