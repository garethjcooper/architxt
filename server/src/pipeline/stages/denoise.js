/**
 * Denoise Stage (v3 Pattern)
 * 
 * Pure text transformation - no I/O, no external dependencies.
 * Cleans extracted markdown for downstream processing.
 * Scaffold version - simplified from archie-ai.
 */
import { createLogger } from '../../utils/logger.js';

const logger = createLogger('stage-denoise');

/**
 * Execute denoise stage (v3 signature)
 * 
 * @param {Object} artifacts - { markdown: string }
 * @param {Object} config - { document_denoise: {...} }
 * @param {Object} data - { doc_id } (unused for denoise)
 * @param {Object} services - {} (no external services)
 * @returns {Promise<{stageResult, stageMetrics, stageOutput}>}
 */
function execute(artifacts, config, data, services) {
  const startTime = Date.now();
  
  const markdown = artifacts.markdown;
  const denoiseConfig = config.document_denoise;

  if (markdown === undefined || markdown === null) {
    return {
      stageResult: { success: false, error: 'No markdown provided in artifacts' },
      stageMetrics: { durationMs: 0 },
      stageOutput: []
    };
  }

  const original = markdown;
  const timeoutMs = denoiseConfig?.timeout_ms ?? 60000;

  logger.debug('Denoise input check', {
    inputLength: markdown.length,
    hasImageTags: markdown.includes('{{IMAGE:')
  });

  // Safety guard: prevent any future regex or split operation from hanging forever
  const deadline = Date.now() + timeoutMs;
  const checkTimeout = (label) => {
    if (Date.now() > deadline) {
      throw new Error(`Denoise timeout (${timeoutMs}ms) at step: ${label}`);
    }
  };

  let cleaned = markdown;
  const stats = {
    whitespaceNormalizations: 0
  };

  try {
    // Step 1: Remove page number patterns
    if (denoiseConfig?.remove_page_numbers) {
      const before = cleaned.length;
      cleaned = removePageNumbers(cleaned, checkTimeout);
      stats.pageNumbersRemoved = before - cleaned.length;
    }

    checkTimeout('after-remove-page-numbers');

    // Step 2: Remove confidential headers
    if (denoiseConfig?.remove_confidential_headers) {
      const before = cleaned.length;
      cleaned = removeConfidentialHeaders(cleaned, checkTimeout);
      stats.confidentialHeadersRemoved = before - cleaned.length;
    }

    checkTimeout('after-remove-confidential');

    // Step 3: Remove document IDs
    if (denoiseConfig?.remove_document_ids) {
      const before = cleaned.length;
      cleaned = removeDocumentIds(cleaned, checkTimeout);
      stats.documentIdsRemoved = before - cleaned.length;
    }

    checkTimeout('after-remove-document-ids');

    // Step 4: Unescape HTML entities
    if (denoiseConfig?.unescape_html_entities) {
      const before = cleaned.length;
      cleaned = unescapeHtmlEntities(cleaned);
      stats.entitiesUnescaped = before - cleaned.length;
    }

    // Step 4b: Unescape spurious Markdown punctuation (e.g. FLAT\_LOW -> FLAT_LOW)
    if (denoiseConfig?.unescape_markdown_punctuation) {
      const before = cleaned.length;
      cleaned = unescapeMarkdownPunctuation(cleaned);
      stats.markdownPunctuationUnescaped = before - cleaned.length;
    }

    // Step 5: Normalize whitespace
    if (denoiseConfig?.normalize_whitespace) {
      const before = cleaned.length;
      cleaned = normalizeWhitespace(cleaned, denoiseConfig.max_consecutive_newlines || 3);
      stats.whitespaceNormalizations = before - cleaned.length;
    }

    checkTimeout('after-normalize-whitespace');

    // Step 6: Remove non-ASCII
    if (denoiseConfig?.remove_non_ascii) {
      const before = cleaned.length;
      cleaned = stripNonAscii(cleaned);
      stats.removeNonAscii = before - cleaned.length;
    }

    checkTimeout('after-strip-non-ascii');

    const durationMs = Date.now() - startTime;
    const reductionPercent = original.length > 0 
      ? ((original.length - cleaned.length) / original.length * 100).toFixed(2)
      : 0;

    logger.info('Denoise complete', { 
      durationMs,
      originalLength: original.length,
      cleanedLength: cleaned.length,
      reductionPercent
    });

    return {
      stageResult: { success: true },
      stageMetrics: { 
        durationMs,
        originalLength: original.length,
        cleanedLength: cleaned.length,
        reductionPercent: parseFloat(reductionPercent)
      },
      stageOutput: [
        { name: 'document-md', data: cleaned }
      ]
    };

  } catch (error) {
    logger.error('Denoise failed', { error: error.message });
    
    return {
      stageResult: { success: false, error: error.message },
      stageMetrics: { durationMs: Date.now() - startTime },
      stageOutput: [
        { name: 'document-md', data: original }
      ]
    };
  }
}

function removePageNumbers(text, checkTimeout) {
  const lines = text.split('\n');
  const result = [];
  for (let i = 0; i < lines.length; i++) {
    if (i % 1000 === 0) checkTimeout('removePageNumbers');
    const line = lines[i];
    const stripped = line.trim();
    if (stripped.length === 0) {
      result.push(line);
      continue;
    }
    if (/^Page\s+\d+\s+of\s+\d+$/i.test(stripped)) continue;
    if (/^\d+\s*\/\s*\d+$/.test(stripped)) continue;
    if (/^\d{1,6}$/.test(stripped)) continue;
    result.push(line);
  }
  return result.join('\n');
}

function removeConfidentialHeaders(text, checkTimeout) {
  const lines = text.split('\n');
  const result = [];
  for (let i = 0; i < lines.length; i++) {
    if (i % 1000 === 0) checkTimeout('removeConfidentialHeaders');
    const stripped = lines[i].trim();
    if (/^CONFIDENTIAL$/i.test(stripped)) continue;
    if (/^\[CONFIDENTIAL\]$/i.test(stripped)) continue;
    if (/^\*\*\s*Confidential\s*\*\*$/i.test(stripped)) continue;
    result.push(lines[i]);
  }
  return result.join('\n');
}

function removeDocumentIds(text, checkTimeout) {
  const lines = text.split('\n');
  const result = [];
  for (let i = 0; i < lines.length; i++) {
    if (i % 1000 === 0) checkTimeout('removeDocumentIds');
    const stripped = lines[i].trim();
    if (/^Document\s*(ID|#)?\s*[:\-]?\s*[A-Z0-9-]+$/i.test(stripped)) continue;
    if (/^Ref\s*[:\-]?\s*[A-Z0-9-]+$/i.test(stripped)) continue;
    if (/^ID\s*[:\-]\s*[A-Z0-9-]+$/i.test(stripped)) continue;
    result.push(lines[i]);
  }
  return result.join('\n');
}

function unescapeHtmlEntities(text) {
  text = text
    .replace(/\\u003c/gi, '<')
    .replace(/\\u003e/gi, '>')
    .replace(/\\u0026/gi, '&');

  text = text.replace(/&#(\d+);/g, (_, dec) => 
    String.fromCharCode(parseInt(dec, 10))
  );

  text = text.replace(/&#x([0-9a-f]+);/gi, (_, hex) => 
    String.fromCharCode(parseInt(hex, 16))
  );

  const named = {
    '&lt;': '<', '&gt;': '>', '&amp;': '&',
    '&quot;': '\x22', '&#39;': '\x27', '&apos;': '\x27',
    '&nbsp;': ' ', '&ensp;': ' ', '&emsp;': ' '
  };
  
  for (const [k, v] of Object.entries(named)) {
    text = text.split(k).join(v);
  }
  
  return text;
}

/**
 * Reverse spurious Markdown punctuation escaping introduced by some Docling
 * exporters (e.g. FLAT\_LOW -> FLAT_LOW, \[text\] -> [text]).
 *
 * Only unescapes backslash before punctuation characters commonly escaped by
 * Markdown generators; literal double-backslashes (\\) are preserved.
 *
 * @param {string} text - Markdown content
 * @returns {string} Text with punctuation escapes removed
 */
function unescapeMarkdownPunctuation(text) {
  return text.replace(/\\([!"#$%&'()*+,\-./:;<=>?@[\]^_`{|}~])/g, '$1');
}

function normalizeWhitespace(text, maxConsecutiveNewlines = 3) {
  const lines = text.split('\n');
  const out = [];
  let emptyStreak = 0;

  for (const rawLine of lines) {
    // Strip leading/trailing spaces/tabs with simple linear scans.
    // Avoid global regexes across the whole document: long Docling table
    // lines with huge runs of padding spaces can make /[ \\t]+\\n/g
    // backtrack catastrophically.
    let start = 0;
    while (start < rawLine.length && (rawLine[start] === ' ' || rawLine[start] === '\t')) {
      start++;
    }
    let end = rawLine.length;
    while (end > start && (rawLine[end - 1] === ' ' || rawLine[end - 1] === '\t')) {
      end--;
    }
    const line = rawLine.slice(start, end);

    if (line.length === 0) {
      emptyStreak++;
      if (emptyStreak <= maxConsecutiveNewlines) {
        out.push('');
      }
    } else {
      emptyStreak = 0;
      out.push(line);
    }
  }

  // Trim trailing empty lines (equivalent to final .trim())
  while (out.length > 0 && out[out.length - 1] === '') {
    out.pop();
  }

  return out.join('\n');
}

function stripNonAscii(text, replacement = '') {
  return text.replace(/[^\x00-\xff]/g, replacement);
}

function validate(config) {
  const errors = [];
  return { valid: errors.length === 0, errors };
}

export { execute, validate };
