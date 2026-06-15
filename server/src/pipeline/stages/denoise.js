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

  logger.debug('Denoise input check', {
    inputLength: markdown.length,
    hasImageTags: markdown.includes('{{IMAGE:')
  });

  let cleaned = markdown;
  const stats = {
    whitespaceNormalizations: 0
  };

  try {
    // Step 1: Remove page number patterns
    if (denoiseConfig?.remove_page_numbers) {
      const before = cleaned.length;
      cleaned = removePageNumbers(cleaned);
      stats.pageNumbersRemoved = before - cleaned.length;
    }

    // Step 2: Remove confidential headers
    if (denoiseConfig?.remove_confidential_headers) {
      const before = cleaned.length;
      cleaned = removeConfidentialHeaders(cleaned);
      stats.confidentialHeadersRemoved = before - cleaned.length;
    }

    // Step 3: Remove document IDs
    if (denoiseConfig?.remove_document_ids) {
      const before = cleaned.length;
      cleaned = removeDocumentIds(cleaned);
      stats.documentIdsRemoved = before - cleaned.length;
    }

    // Step 4: Unescape HTML entities
    if (denoiseConfig?.unescape_html_entities) {
      const before = cleaned.length;
      cleaned = unescapeHtmlEntities(cleaned);
      stats.entitiesUnescaped = before - cleaned.length;
    }

    // Step 5: Normalize whitespace
    if (denoiseConfig?.normalize_whitespace) {
      const before = cleaned.length;
      cleaned = normalizeWhitespace(cleaned, denoiseConfig.max_consecutive_newlines || 3);
      stats.whitespaceNormalizations = before - cleaned.length;
    }

    // Step 6: Remove non-ASCII
    if (denoiseConfig?.remove_non_ascii) {
      const before = cleaned.length;
      cleaned = stripNonAscii(cleaned);
      stats.removeNonAscii = before - cleaned.length;
    }

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

function removePageNumbers(text) {
  const patterns = [
    /\n?\s*Page\s+\d+\s+of\s+\d+\s*\n?/gi,
    /\n?\s*-?\s*\d+\s*-?\s*\n(?=\n|$)/g,
    /\n?\s*\d+\s*\/\s*\d+\s*\n/g,
    /^\s*\d+\s*$/gm
  ];
  
  let result = text;
  for (const pattern of patterns) {
    result = result.replace(pattern, '\n');
  }
  return result;
}

function removeConfidentialHeaders(text) {
  const patterns = [
    /\n?\s*CONFIDENTIAL\s*\n?/gi,
    /\n?\s*\[CONFIDENTIAL\]\s*\n?/gi,
    /\n?\s*\*\*\s*Confidential\s*\*\*\s*\n?/gi
  ];
  
  let result = text;
  for (const pattern of patterns) {
    result = result.replace(pattern, '\n');
  }
  return result;
}

function removeDocumentIds(text) {
  const patterns = [
    /\n?\s*Document\s*(ID|#)?\s*[:\-]?\s*[A-Z0-9-]+\s*\n?/gi,
    /\n?\s*Ref\s*[:\-]?\s*[A-Z0-9-]+\s*\n?/gi,
    /\n?\s*ID\s*[:\-]\s*[A-Z0-9-]+\s*\n?/gi
  ];
  
  let result = text;
  for (const pattern of patterns) {
    result = result.replace(pattern, '\n');
  }
  return result;
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

function normalizeWhitespace(text, maxConsecutiveNewlines = 3) {
  const pattern = new RegExp(`\n{${maxConsecutiveNewlines + 1},}`, 'g');
  const replacement = '\n'.repeat(maxConsecutiveNewlines);
  
  return text
    .replace(pattern, replacement)
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n[ \t]+/g, '\n')
    .trim();
}

function stripNonAscii(text, replacement = '') {
  return text.replace(/[^\x00-\xff]/g, replacement);
}

function validate(config) {
  const errors = [];
  return { valid: errors.length === 0, errors };
}

export { execute, validate };
