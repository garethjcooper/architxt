import { generateCompletion } from '../llm/client.js';
import { config } from '../../config.js';
import { createLogger } from '../../utils/logger.js';
import { chunkSource } from './chunker.js';

const logger = createLogger('trace-profile-suggest');

const MAX_SUGGESTION_SAMPLE_RECORDS = 40;
const MAX_SUGGESTION_SAMPLE_CHARS_DEFAULT = 20000;
const MAX_COVERAGE_RESULT_CHARS = 6000;
const MIN_RECORD_CAP = 2000;
const MAX_RECORD_CAP = 30000;
const RECORD_CAP_BUDGET_FRACTION = 0.20;
const UNMATCHED_SAMPLE_BUDGET_FRACTION = 0.50;

/**
 * Ask an LLM to generate or refine a trace profile config from a raw sample.
 *
 * Constrains the model to the built-in engines and attempts to coerce the
 * response into a usable config object. Returns a result shape that the UI can
 * display for assessment/editing before saving.
 *
 * The generated config is intentionally row-only: it detects the format/engine,
 * record/row boundaries, header presence, and (when necessary) multi-line payload
 * stitching. No fieldMap, kindMap, fieldExtraction, or attribute suggestions are
 * emitted.
 *
 * @param {string} sample
 * @param {object} [options]
 * @param {object} [options.currentConfig] - Existing config to refine.
 * @param {object} [options.coverageResult] - Coverage result to drive iteration.
 * @param {number} [options.sampleBudget] - Max characters of the sample to send to the LLM (default 20k).
 * @returns {Promise<{ valid: boolean; engine?: string; reasoning?: string; config?: object; error?: string; provenance?: object }>}
 */
export async function suggestTraceProfileConfig(sample, options = {}) {
  const cfg = config.traceProfileSuggest;
  const { currentConfig, coverageResult, sampleBudget } = options;

  const prompt = buildTraceProfileSuggestionPrompt(sample, { currentConfig, coverageResult, sampleBudget });
  const provenance = buildProvenance(sample, { currentConfig, coverageResult, prompt, sampleBudget });

  const messages = [
    {
      role: 'system',
      content: cfg.system_prompt,
    },
    {
      role: 'user',
      content: prompt,
    },
  ];

  const result = await generateCompletion(messages, {
    provider: cfg.provider,
    model: cfg.model,
    temperature: cfg.temperature,
    max_tokens: cfg.max_tokens,
  });

  if (!result.success) {
    logger.warn('LLM trace profile suggestion failed', { error: result.error, code: result.code });
    return { valid: false, error: result.error || 'LLM request failed', code: result.code, provenance };
  }

  const raw = result.data?.content || '';
  const extracted = extractJsonFromMarkdown(raw);

  try {
    const parsed = JSON.parse(extracted);
    if (!parsed.config || typeof parsed.config !== 'object' || !parsed.config.parser?.module) {
      return {
        valid: false,
        error: 'LLM response did not contain a valid parser config object',
        raw,
        provenance,
      };
    }

    const allowedEngines = ['delimited', 'plaintext', 'json-lines', 'json-nd', 'xml'];
    const engine = normalizeEngineName(parsed.engine || parsed.config.parser.module);
    const moduleName = normalizeEngineName(parsed.config.parser.module);
    parsed.config.parser.module = moduleName;
    if (!allowedEngines.includes(engine)) {
      return {
        valid: false,
        error: `LLM chose unsupported engine: ${engine}`,
        engine,
        raw,
        provenance,
      };
    }

    const cleanConfig = stripFieldExtraction(parsed.config);

    return {
      valid: true,
      engine,
      reasoning: parsed.reasoning || '',
      config: cleanConfig,
      raw,
      provenance,
    };
  } catch (err) {
    logger.warn('Failed to parse LLM trace profile suggestion', { error: err.message, raw: raw.slice(0, 200) });
    return {
      valid: false,
      error: `Could not parse LLM response as JSON: ${err.message}`,
      raw,
      provenance,
    };
  }
}

/**
 * Strip field-extraction concerns out of a config so the generator stays focused
 * on format/row detection only.
 *
 * @param {object} config
 * @returns {object}
 */
function stripFieldExtraction(config) {
  if (!config || typeof config !== 'object') return config;
  const cleaned = { ...config };
  delete cleaned.standardLog;
  delete cleaned.kindMap;
  delete cleaned.payloadExtraction;
  if (cleaned.parser?.config?.records) {
    const records = { ...cleaned.parser.config.records };
    delete records.fieldExtraction;
    if (records.variants) {
      records.variants = records.variants.map((variant) => {
        const v = { ...variant };
        delete v.fieldMap;
        delete v.defaults;
        return v;
      });
    }
    cleaned.parser.config = {
      ...cleaned.parser.config,
      records,
    };
  }
  return cleaned;
}

/**
 * Build a lightweight provenance record describing what was sent to the LLM.
 *
 * @param {string} sample
 * @param {object} options
 * @param {object} [options.currentConfig]
 * @param {object} [options.coverageResult]
 * @param {string} options.prompt
 * @returns {object}
 */
function buildProvenance(sample, { currentConfig, coverageResult, prompt, sampleBudget }) {
  const isIteration = currentConfig != null && typeof currentConfig === 'object' && Object.keys(currentConfig).length > 0;
  const budget = resolveSampleBudget(sampleBudget);
  const truncatedSample = truncateSampleForSuggestion(sample, currentConfig, { coverageResult, sampleBudget: budget });

  return {
    mode: isIteration ? 'iteration' : 'generation',
    engine: currentConfig?.parser?.module || null,
    prompt,
    promptLength: prompt.length,
    sampleLength: (sample || '').length,
    truncatedSampleLength: truncatedSample.length,
    sampleWasTruncated: truncatedSample.length < (sample || '').length,
    sampleBudget: budget,
    coverageSummary: coverageResult
      ? {
          totalRecords: coverageResult.totalRecords,
          totalMatched: coverageResult.totalMatched,
          overallCoverage: coverageResult.overallCoverage,
          valid: coverageResult.valid,
          error: coverageResult.error,
          chunkCount: Array.isArray(coverageResult.chunks) ? coverageResult.chunks.length : 0,
        }
      : null,
    timestamp: new Date().toISOString(),
  };
}

/**
 * Build the user prompt sent to the LLM. Exported for testing.
 *
 * @param {string} sample
 * @param {object} options
 * @param {object} [options.currentConfig]
 * @param {object} [options.coverageResult]
 * @returns {string}
 */
export function buildTraceProfileSuggestionPrompt(sample, { currentConfig, coverageResult, sampleBudget }) {
  const isIteration = currentConfig != null && typeof currentConfig === 'object' && Object.keys(currentConfig).length > 0;
  const budget = resolveSampleBudget(sampleBudget);
  const lines = [
    isIteration
      ? 'Refine an existing Architxt trace profile parser config for the following raw sample.'
      : 'Generate an Architxt trace profile parser config for the following raw sample.',
    'Only use one of the supported engines: delimited, plaintext, json-lines, json-nd, xml.',
    '',
    'The goal is to detect the format and the boundaries of logical rows/records ONLY.',
    'Do NOT emit fieldMap, fieldExtraction, kindMap, payloadExtraction, standardLog.sortBy, or any attribute/column mapping.',
    'The output of the parser is a list of raw detected rows; downstream code will decide how to interpret fields.',
    '',
    'Engine selection guidance:',
    '- delimited: use when rows have consistent columns (CSV/TSV/pipe/etc). If one column contains a multi-line XML/JSON payload that continues onto following lines, set records.payloadStitching to "xml" or "json".',
    '- plaintext: use when records are identified by a leading regex pattern and there are no reliable delimiters.',
    '- json-lines: use when the file is newline-delimited JSON (NDJSON) where each line is an independent object.',
    '- json-nd: use when the file is a pretty-printed JSON object or array that spans multiple lines. For a root array, each element is a row. For a root object, the whole document is one row unless recordStartPath/Pattern selects a nested array.',
    '- xml: use when the file is an XML document or a stream of concatenated XML elements. A root element wrapping repeated children (e.g. <log><event/>...</log>) is split so each child is a row; concatenated top-level elements are split per element. Set records.splitElements to false to keep the whole document as one row, or records.recordStartTag to only accept elements with that tag name.',
    'If you are refining an existing config and a different engine would clearly give higher coverage, you MAY change the engine. Explain your choice in the reasoning field.',
    '',
    'JSON engine schema (applies to json-lines and json-nd):',
    '- records.recordStartPath: optional dot-notation path that, if present, marks which objects begin a new row.',
    '- records.recordStartPattern: optional regex tested against the JSON-serialised object (or the value at recordStartPath) to decide whether the object starts a new row.',
    '- Do NOT emit records.fieldExtraction or records.variants[].fieldMap.',
    '',
    'Record-boundary guidance for the delimited engine:',
    '- If the sample starts with a header row and input.hasHeader is true, the backend knows the first data row begins after the header.',
    '- Only provide records.recordStartRule if there is no header and rows must be identified by a custom key pattern (e.g. a leading timestamp or UUID).',
    '- If payloadStitching is enabled, lines that look like XML/JSON continuations are treated as part of the current row, never as a new row.',
    '',
    'Record-boundary guidance for the plaintext engine:',
    '- records.recordStartPattern is a regex matching the first line of each logical row.',
    '- records.payloadStitching may be "xml" or "json" to pull following XML/JSON lines into the current row.',
    '',
    'Record-boundary guidance for the xml engine:',
    '- records.splitElements: true (default) splits a wrapper root element into one row per child element, and splits concatenated top-level elements per element. false keeps the whole document as a single row.',
    '- records.recordStartTag: optional tag name; only elements with this tag are treated as record starts.',
    '',
    'Keep row-boundary regexes tight: anchor with ^ where possible and prefer the shortest pattern that reliably identifies the start of a logical row.',
    '',
    'The parser emits raw detected rows. Each row is one logical record, possibly spanning multiple physical lines, with at minimum the keys "raw" and "unparsed".',
    'No field extraction, kind mapping, sorting, or relationship extraction happens at this stage.',
    '',
    'Example delimited config with header and XML payload stitching:',
    '{',
    '  "parser": {',
    '    "config": {',
    '      "input": { "encoding": "utf-8", "delimiter": "\\t", "quoteChar": "", "hasHeader": true },',
    '      "records": {',
    '        "payloadStitching": "xml",',
    '        "multilineColumn": "payload"',
    '      }',
    '    }',
    '  }',
    '}',
    '',
    'Example plaintext config:',
    '{',
    '  "parser": {',
    '    "config": {',
    '      "input": { "encoding": "utf-8" },',
    '      "records": {',
    '        "recordStartPattern": "^\\[(?<timestamp>[^\\]]+)\\]",',
    '        "payloadStitching": "xml"',
    '      }',
    '    }',
    '  }',
    '}',
    '',
    'Example json-lines config:',
    '{',
    '  "parser": {',
    '    "config": {',
    '      "input": { "encoding": "utf-8" },',
    '      "records": {',
    '        "recordStartPath": "id"',
    '      }',
    '    }',
    '  }',
    '}',
  ];

  const truncatedSample = truncateSampleForSuggestion(sample, currentConfig, { coverageResult, sampleBudget: budget });
  const plaintextBias = looksLikePlaintextSample(truncatedSample);
  const detectedDelimiter = plaintextBias ? null : detectDelimiterForSuggestion(truncatedSample, currentConfig);
  if (plaintextBias) {
    lines.push(
      '',
      'DETECTED FORMAT: plaintext. The sample lines overwhelmingly start with a record-start marker (e.g. a leading "[timestamp]" block or date) and no delimiter yields consistent columns. Use the plaintext engine with a records.recordStartPattern matching that leading marker; do NOT choose delimited.'
    );
  } else if (detectedDelimiter != null) {
    lines.push('', `Detected field delimiter for the delimited engine: ${JSON.stringify(detectedDelimiter)}. If you choose delimited, set input.delimiter to this value.`);
  }
  const sampleNote = truncatedSample.length < (sample || '').length
    ? `Note: the sample has been truncated to fit the context window (budget: ${budget} chars; shown: ${truncatedSample.length} chars). Your config must still match this representative subset.`
    : null;

  if (isIteration) {
    lines.push('', '--- CURRENT CONFIG START ---');
    lines.push(JSON.stringify(currentConfig, null, 2));
    lines.push('--- CURRENT CONFIG END ---');
  }

  if (coverageResult != null && typeof coverageResult === 'object') {
    const trimmedCoverage = trimCoverageResult(coverageResult);
    lines.push('', '--- COVERAGE RESULT START ---');
    lines.push(trimmedCoverage.json);
    lines.push('--- COVERAGE RESULT END ---');

    const unmatched = extractUnmatchedSamples(coverageResult);
    if (unmatched.length > 0) {
      lines.push(
        '',
        `Instruction: ${unmatched.length} unmatched record(s) are included first in the SAMPLE section below. Fix those records first.`,
        'Add or broaden row-boundary rules until every unmatched line is part of a detected row. Do NOT make the first rule more restrictive; keep it matching the base record-start shape, and use additional rules only for extended shapes.'
      );
    } else if ((coverageResult.overallCoverage || coverageResult.coverage || 0) === 0) {
      lines.push(
        '',
        'Instruction: coverage is 0. Check that the record-start rule/pattern actually matches the first data line and that payloadStitching/multilineColumn is correct for any multi-line payloads.',
        'Do NOT change the engine unless the data clearly has no delimiters.'
      );
    }
  }

  const firstDataLine = findFirstDataLine(sample, currentConfig);
  if (firstDataLine) {
    lines.push('', `First non-header data line (use this to verify row boundaries): ${JSON.stringify(firstDataLine)}`);
  }

  lines.push('', '--- SAMPLE START ---');
  if (sampleNote) lines.push(sampleNote);
  lines.push(
    'Important: when using the delimited engine, check whether any column contains a multi-line XML/JSON payload that continues onto following lines. If so, set records.payloadStitching to "xml" or "json".',
    'Note: very long payload lines in the sample are truncated with a [...truncated N chars...] marker so that multiple records fit in the context window. The real file is not truncated; only this prompt preview is capped.',
    ''
  );
  lines.push(truncatedSample);
  lines.push('--- SAMPLE END ---');

  return lines.join('\n');
}

/**
 * Detect the most likely field delimiter for a delimited sample.
 *
 * Returns the separator character (or string) that produces the most consistent
 * column count across non-empty, non-continuation lines. Prefers the delimiter
 * already configured in currentConfig when it is viable.
 *
 * @param {string} sample
 * @param {object} [currentConfig]
 * @returns {string|null}
 */
export function detectDelimiterForSuggestion(sample, currentConfig) {
  if (typeof sample !== 'string' || sample.length === 0) return null;

  const candidates = ['\t', '|', ',', ';', ' '];
  const existing = currentConfig?.parser?.config?.input?.delimiter;
  if (existing && typeof existing === 'string' && !candidates.includes(existing)) {
    candidates.unshift(existing);
  }

  const lines = sample.split(/\r?\n/).filter((l) => l.trim().length > 0);
  // Ignore lines that look like XML/JSON continuations — they are payload rows, not start rows.
  const startLines = lines.filter((l) => !/^\s*[<{]/.test(l));
  if (startLines.length === 0) return null;

  let best = null;
  let bestScore = -1;

  for (const delim of candidates) {
    const counts = startLines.map((l) => l.split(delim).filter(Boolean).length);
    const nonTrivial = counts.filter((c) => c > 1);
    if (nonTrivial.length === 0) continue;

    const mean = nonTrivial.reduce((a, b) => a + b, 0) / nonTrivial.length;
    const variance = nonTrivial.reduce((sum, c) => sum + Math.pow(c - mean, 2), 0) / nonTrivial.length;
    const consistency = nonTrivial.length / startLines.length;
    // Prefer more columns, stable counts, and high coverage. Existing delimiter gets a tie-break bonus.
    const existingBonus = delim === existing ? 0.5 : 0;
    const score = consistency * (mean + 1) / (variance + 1) + existingBonus;

    if (score > bestScore) {
      bestScore = score;
      best = delim;
    }
  }

  return best;
}

/**
 * Heuristic pre-check: does the sample look like free-form log lines whose
 * records are identified by a leading start pattern (e.g. a leading
 * "[timestamp]" bracket or an ISO date) rather than by fixed columns?
 *
 * Returns a score in [0,1]: fraction of non-empty, non-continuation lines that
 * match a generic record-start pattern. High score + no reliably consistent
 * delimiter => the sample is plaintext-shaped, and the LLM prompt should be
 * biased toward the plaintext engine.
 *
 * @param {string} sample
 * @returns {number}
 */
export function detectRecordStartPatternCoverage(sample) {
  if (typeof sample !== 'string' || sample.length === 0) return 0;
  const lines = sample.split(/\r?\n/).filter((l) => l.trim().length > 0);
  const startLines = lines.filter((l) => !/^\s*[<{]/.test(l));
  if (startLines.length === 0) return 0;
  // Generic record-start shapes: leading [..] bracket block, ISO date, or a
  // slash/dot date at line start.
  const recordStart = /^\s*(\[[^\]]+\]|\d{4}-\d{2}-\d{2}[T ]\d{2}:|\d{1,2}[/\-.]\d{1,2}[/\-.]\d{2,4}\s)/;
  const hits = startLines.filter((l) => recordStart.test(l)).length;
  return hits / startLines.length;
}

/**
 * Decide whether the sample strongly suggests the plaintext engine over
 * delimited: a high fraction of lines match a generic record-start pattern
 * AND no candidate delimiter yields a consistently low-variance column count
 * on those record-start lines.
 *
 * @param {string} sample
 * @returns {boolean}
 */
export function looksLikePlaintextSample(sample) {
  const lines = sample.split(/\r?\n/).filter((l) => l.trim().length > 0);
  // Ignore lines that look like XML/JSON continuations or escaped-markup noise.
  const startLines = lines.filter((l) => !/^\s*[<{&]/i.test(l));
  if (startLines.length === 0) return false;
  const recordStart = /^\s*(\[[^\]]+\]|\d{4}-\d{2}-\d{2}[T ]\d{2}:|\d{1,2}[/\-.]\d{1,2}[/\-.]\d{2,4}\s)/;
  const recordLines = startLines.filter((l) => recordStart.test(l));
  if (recordLines.length < 3) return false;
  // Records must be the dominant line shape: continuation/payload lines should
  // not outnumber record-start lines (otherwise this is a multi-line payload
  // format, not one-record-per-line plaintext).
  if (recordLines.length / startLines.length < 0.5) return false;

  // A delimiter is "reliable" on record-start lines when it splits almost all
  // of them into >1 column AND the column counts have low variance. Free-form
  // log lines split on spaces with wildly varying counts, so they fail this.
  for (const delim of ['\t', '|', ',', ';']) {
    const counts = recordLines.map((l) => l.split(delim).filter(Boolean).length).filter((c) => c > 1);
    if (counts.length / recordLines.length < 0.9) continue;
    const mean = counts.reduce((a, b) => a + b, 0) / counts.length;
    const variance = counts.reduce((s, c) => s + Math.pow(c - mean, 2), 0) / counts.length;
    if (variance / (mean * mean) < 0.2) return false;
  }
  return true;
}

/**
 * Return a bounded subset of the raw sample for the LLM prompt.
 *
 * When an existing config is available we chunk by logical records so multi-line
 * payloads stay intact. Unmatched records from the coverage result are always
 * included first so the LLM can see the actual failures it must fix.
 *
 * @param {string} sample
 * @param {object} [currentConfig]
 * @param {object} [options]
 * @param {object} [options.coverageResult]
 * @param {number} [options.sampleBudget]
 * @returns {string}
 */
function truncateSampleForSuggestion(sample, currentConfig, { coverageResult, sampleBudget } = {}) {
  if (typeof sample !== 'string' || sample.length === 0) return sample || '';

  const budget = resolveSampleBudget(sampleBudget);

  const hasEngine = currentConfig?.parser?.module;
  if (!hasEngine) {
    // Generation mode: preserve the file head until the budget runs out.
    const lineLimited = sample.split(/\r?\n/).slice(0, MAX_SUGGESTION_SAMPLE_RECORDS * 4).join('\n');
    return lineLimited.slice(0, budget);
  }

  try {
    const { chunks, headerLine } = chunkSource(currentConfig, sample, {
      chunkBy: 'records',
      chunkSize: 1,
    });

    // Detect degenerate chunking: if every chunk is a single physical line, the
    // record boundary detector is not finding logical records. In that case we
    // fall back to raw lines so the LLM can see the real header and start rows.
    const chunkLineCounts = chunks.map((c) => (c.content || '').split(/\r?\n/).length);
    const totalChunkLines = chunkLineCounts.reduce((a, b) => a + b, 0);
    const isDegenerate = chunks.length > 0 && totalChunkLines <= chunks.length + 1;

    if (isDegenerate) {
      const lineLimited = sample.split(/\r?\n/).slice(0, MAX_SUGGESTION_SAMPLE_RECORDS * 4).join('\n');
      return lineLimited.slice(0, budget);
    }

    // Separate unmatched records from the full file so we can prioritise them.
    const unmatchedSet = new Set(extractUnmatchedSamples(coverageResult).map((r) => r.trim()));
    const unmatchedChunks = [];
    const matchedChunks = [];
    for (const chunk of chunks) {
      const content = chunk?.content || '';
      if (headerLine && content.startsWith(`${headerLine}\n`)) {
        matchedChunks.push({ ...chunk, content: content.slice(headerLine.length + 1) });
      } else if (unmatchedSet.has(content.trim())) {
        unmatchedChunks.push(chunk);
      } else {
        matchedChunks.push(chunk);
      }
    }

    const recordCap = resolveRecordCap(budget);
    const unmatchedBudget = Math.floor(budget * UNMATCHED_SAMPLE_BUDGET_FRACTION);
    const parts = [];
    if (headerLine) parts.push(headerLine);
    let used = parts.reduce((sum, p) => sum + p.length, 0);

    // Always include unmatched records first, full logical record intact up to the per-record cap.
    let unmatchedUsed = 0;
    for (const chunk of unmatchedChunks) {
      let content = capRecordContent(chunk.content, recordCap);
      if ((unmatchedUsed + content.length + 1 > unmatchedBudget && unmatchedUsed > 0)
          || (used + content.length + 1 > budget && used > 0)) break;
      parts.push(content);
      unmatchedUsed += content.length + 1;
      used += content.length + 1;
    }

    // Fill remaining budget with representative matched records.
    for (const chunk of matchedChunks) {
      if (!chunk || !chunk.content) continue;
      let content = chunk.content;
      if (headerLine && content.startsWith(`${headerLine}\n`)) {
        content = content.slice(headerLine.length + 1);
      }
      content = capRecordContent(content, recordCap);
      if (used + content.length + 1 > budget && used > 0) break;
      parts.push(content);
      used += content.length + 1;
      if (used >= budget) break;
    }

    return parts.join('\n').slice(0, budget);
  } catch (err) {
    logger.warn('Failed to chunk sample for suggestion; falling back to line limit', { error: err.message });
    const lineLimited = sample.split(/\r?\n/).slice(0, MAX_SUGGESTION_SAMPLE_RECORDS * 4).join('\n');
    return lineLimited.slice(0, budget);
  }
}

/**
 * Cap any individual logical record that exceeds the budget per record.
 *
 * Large mid-row XML/JSON payloads can consume the entire sample budget and leave
 * no room for additional records. The cap scales with the user-selected budget
 * so higher budgets reveal more payload structure, but never grows large enough
 * to drown out all other records.
 *
 * @param {string} content
 * @param {number} recordCap
 * @returns {string}
 */
function capRecordContent(content, recordCap) {
  if (typeof content !== 'string' || content.length <= recordCap) return content;
  // Keep head and tail but bias toward the head, because row-boundary signals
  // are usually anchored near the start of a logical record.
  const headChars = Math.max(Math.floor(recordCap * 0.75), recordCap - 500);
  const tailChars = recordCap - headChars;
  const head = content.slice(0, headChars);
  const tail = content.slice(-tailChars);
  const omitted = content.length - headChars - tailChars;
  return `${head}\n[...truncated ${omitted} chars...]\n${tail}`;
}

/**
 * Resolve the per-record cap from the chosen sample budget.
 *
 * Higher budgets allow longer logical records to stay intact, but we keep a
 * floor and ceiling so a single huge record cannot monopolise the prompt.
 *
 * @param {number} budget
 * @returns {number}
 */
function resolveRecordCap(budget) {
  const scaled = Math.floor(budget * RECORD_CAP_BUDGET_FRACTION);
  return Math.min(MAX_RECORD_CAP, Math.max(MIN_RECORD_CAP, scaled));
}

/**
 * Resolve the prompt sample budget from the user option or config default.
 *
 * @param {number} [value]
 * @returns {number}
 */
function resolveSampleBudget(value) {
  const cfg = config.traceProfileSuggest;
  const parsed = Number(value);
  if (Number.isFinite(parsed) && parsed >= 1000) return Math.min(parsed, 1000000);
  return cfg.sample_budget_default ?? MAX_SUGGESTION_SAMPLE_CHARS_DEFAULT;
}

/**
 * Extract a concise, deduplicated list of unmatched record samples from a coverage result.
 *
 * @param {object} coverageResult
 * @returns {{ json: string, truncated: boolean }}
 */
function trimCoverageResult(coverageResult) {
  const compact = JSON.stringify(coverageResult);
  if (compact.length <= MAX_COVERAGE_RESULT_CHARS) {
    return { json: JSON.stringify(coverageResult, null, 2), truncated: false };
  }

  // Keep high-level fields; drop verbose per-chunk raw samples but keep counts.
  const summary = {
    totalRecords: coverageResult.totalRecords,
    totalMatched: coverageResult.totalMatched,
    overallCoverage: coverageResult.overallCoverage,
    valid: coverageResult.valid,
    error: coverageResult.error,
    chunks: (coverageResult.chunks || []).map((chunk) => ({
      chunkId: chunk.chunkId,
      range: chunk.range,
      totalRecords: chunk.totalRecords,
      matched: chunk.matched,
      unmatched: chunk.unmatched,
      coverage: chunk.coverage,
      unparsedSampleCount: Array.isArray(chunk.unparsedSamples) ? chunk.unparsedSamples.length : 0,
    })),
  };

  let json = JSON.stringify(summary, null, 2);
  if (json.length > MAX_COVERAGE_RESULT_CHARS) {
    json = JSON.stringify(summary);
  }
  if (json.length > MAX_COVERAGE_RESULT_CHARS) {
    json = json.slice(0, MAX_COVERAGE_RESULT_CHARS) + '\n... (truncated)';
  }
  return { json, truncated: true };
}

/**
 * Extract a concise, deduplicated list of unmatched record samples from a coverage result.
 *
 * @param {object} coverageResult
 * @returns {string[]}
 */
function extractUnmatchedSamples(coverageResult) {
  if (!coverageResult || typeof coverageResult !== 'object') return [];

  const seen = new Set();
  const samples = [];
  const add = (raw) => {
    const key = (raw || '').trim();
    if (!key || seen.has(key)) return;
    seen.add(key);
    samples.push(key);
  };

  if (Array.isArray(coverageResult.unparsedSamples)) {
    coverageResult.unparsedSamples.forEach(add);
  }

  if (Array.isArray(coverageResult.chunks)) {
    for (const chunk of coverageResult.chunks) {
      if (Array.isArray(chunk.unparsedSamples)) {
        chunk.unparsedSamples.forEach(add);
      }
    }
  }

  return samples;
}

/**
 * Pull a JSON object out of a markdown-fenced LLM response.
 *
 * @param {string} content
 * @returns {string}
 */
function extractJsonFromMarkdown(content) {
  const fenceMatch = content.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenceMatch) {
    return fenceMatch[1].trim();
  }
  // Otherwise try to find the first {...} block.
  const braceMatch = content.match(/\{[\s\S]*\}/);
  return braceMatch ? braceMatch[0].trim() : content.trim();
}

/**
 * Normalize an engine/module name to the short form the registry expects.
 *
 * LLMs sometimes return fully-qualified names like "architxt.parsers.delimited".
 * This strips any "architxt.parsers." prefix so the registry can find the engine.
 *
 * @param {string} name
 * @returns {string}
 */
function normalizeEngineName(name) {
  if (!name || typeof name !== 'string') return '';
  return name.replace(/^architxt\.parsers\./, '');
}

/**
 * Return the first non-empty, non-header line of a sample so the LLM can
 * compare it against the configured record start rule.
 *
 * @param {string} sample
 * @param {object} currentConfig
 * @returns {string|null}
 */
function findFirstDataLine(sample, currentConfig) {
  if (typeof sample !== 'string') return null;
  const hasHeader = currentConfig?.parser?.config?.input?.hasHeader
    ?? currentConfig?.input?.hasHeader
    ?? false;
  const lines = sample.split(/\r?\n/);
  let skippedHeader = false;
  for (const line of lines) {
    if (!line.trim()) continue;
    if (hasHeader && !skippedHeader) {
      skippedHeader = true;
      continue;
    }
    return line;
  }
  return null;
}
