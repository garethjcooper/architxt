import { BaseTraceParser, buildUnparsedRecord } from './base-parser.js';
import { createLogger } from '../../../utils/logger.js';

const logger = createLogger('trace-xml-parser');

const XML_DECL_REGEX = /^\s*<\?xml[^?]*\?>/;

/**
 * XML format engine — row detection only.
 *
 * Handles whole-file XML documents and streams of concatenated XML elements:
 *  - A single root element covering the whole file is ONE record.
 *  - A root element wrapping repeated child elements (e.g. <log><event/>…)
 *    is split so each child element is ONE record (records.splitElements, on
 *    by default, off when records.splitElements === false).
 *  - Concatenated top-level elements (no common root) are split per element.
 *
 * Each record's `raw` is the exact source slice of its element, so the
 * existing XML payload field extraction (extractPayloadFields) expands the
 * element's leaf paths and @attributes downstream.
 *
 * Output records are intentionally flat and raw: `{ raw, unparsed? }`.
 * No field extraction, fieldMap, kindMap, or attribute mapping happens here.
 */
export class XmlParser extends BaseTraceParser {
  constructor(profileConfig) {
    super(profileConfig);
    const input = this.config.input || {};
    const records = this.config.records || {};
    this.encoding = input.encoding || 'utf-8';
    this.splitElements = records.splitElements !== false; // default true
    this.recordStartTag = typeof records.recordStartTag === 'string' && records.recordStartTag
      ? records.recordStartTag
      : null;
  }

  /**
   * @param {string} _filePath
   * @param {Buffer|string} content
   * @returns {Promise<Array<object>>}
   */
  async parseFile(_filePath, content) {
    const text = Buffer.isBuffer(content) ? content.toString(this.encoding) : String(content);
    const ranges = findXmlElementRanges(text, {
      splitElements: this.splitElements,
      recordStartTag: this.recordStartTag,
    });

    if (ranges.length === 0) {
      return text.trim() ? [buildUnparsedRecord(text)] : [];
    }

    return ranges.map((r) => ({ raw: text.slice(r.start, r.end + 1) }));
  }
}

/**
 * Find top-level XML element ranges in a source string.
 *
 * Returns character ranges [start, end] (inclusive) of the record elements.
 * Preface content (XML declaration, comments, whitespace) is skipped.
 *
 * @param {string} text
 * @param {{ splitElements?: boolean, recordStartTag?: string | null }} [options]
 * @returns {Array<{ start: number, end: number }>}
 */
export function findXmlElementRanges(text, options = {}) {
  const splitElements = options.splitElements !== false;
  const startTag = options.recordStartTag || null;
  const scanner = new XmlScanner(text);
  const topRanges = scanner.topLevelElements(startTag);

  if (topRanges.length === 0) return [];

  // Single top-level element: it may be a wrapper whose children are the
  // logical records (e.g. <log><event/>...</log>).
  if (topRanges.length === 1 && splitElements) {
    const only = topRanges[0];
    let inner = scanner.childElements(only.start, only.end);
    if (startTag) inner = inner.filter((r) => scanner.tagNameAt(r.start) === startTag);
    if (inner.length > 1) return inner;
    if (inner.length === 1) {
      // Wrapper with a single matching child: treat the child as the record
      // only when the wrapper tag differs from it.
      const wrapperTag = scanner.tagNameAt(only.start);
      const childTag = scanner.tagNameAt(inner[0].start);
      if (childTag && childTag !== wrapperTag) return inner;
    }
    return [only];
  }

  // Multiple concatenated top-level elements: each is a record.
  return topRanges;
}

/**
 * Detect XML element boundaries in raw source lines for the chunker.
 *
 * @param {string[]} lines
 * @param {object} parserConfig
 * @returns {Array<{startLine: number, endLine: number}>}
 */
export function findXmlElementBoundaries(lines, parserConfig) {
  const text = lines.join('\n');
  const records = (parserConfig && parserConfig.records) || {};
  const ranges = findXmlElementRanges(text, {
    splitElements: records.splitElements !== false,
    recordStartTag: typeof records.recordStartTag === 'string' ? records.recordStartTag : null,
  });
  if (ranges.length === 0) return [];

  const lineStarts = [0];
  for (let i = 0; i < text.length; i++) {
    if (text[i] === '\n') lineStarts.push(i + 1);
  }
  const lineOf = (charIndex) => {
    let lo = 0, hi = lineStarts.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (lineStarts[mid] <= charIndex) lo = mid; else hi = mid - 1;
    }
    return lo;
  };
  return ranges.map((r) => ({ startLine: lineOf(r.start), endLine: lineOf(r.end) }));
}

/**
 * Minimal non-validating XML scanner: tracks tags, comments, CDATA, and
 * processing instructions well enough to find element boundaries in
 * well-formed input. Strings inside attribute values are respected.
 */
class XmlScanner {
  constructor(text) {
    this.text = text;
  }

  tagNameAt(openTagStart) {
    const m = /^<([A-Za-z_:][A-Za-z0-9_:.:-]*)/.exec(this.text.slice(openTagStart));
    return m ? m[1] : null;
  }

  /**
   * Scan top-level elements, optionally skipping elements whose tag name
   * does not match recordStartTag.
   */
  topLevelElements(recordStartTag) {
    const ranges = [];
    const stack = []; // open element ranges
    let i = 0;
    const text = this.text;
    const n = text.length;

    while (i < n) {
      const lt = text.indexOf('<', i);
      if (lt === -1) break;

      if (text.startsWith('<!--', lt)) {
        const end = text.indexOf('-->', lt + 4);
        i = end === -1 ? n : end + 3;
        continue;
      }
      if (text.startsWith('<![CDATA[', lt)) {
        const end = text.indexOf(']]>', lt + 9);
        i = end === -1 ? n : end + 3;
        continue;
      }
      if (text.startsWith('<?', lt)) {
        const end = text.indexOf('?>', lt + 2);
        i = end === -1 ? n : end + 2;
        continue;
      }
      if (text.startsWith('</', lt)) {
        const end = text.indexOf('>', lt + 2);
        const tag = end === -1 ? null : /^<\/([A-Za-z_:][A-Za-z0-9_:.:-]*)/.exec(text.slice(lt, end + 1));
        if (stack.length > 0) {
          const open = stack.pop();
          if (end !== -1 && tag && tag[1] === this.tagNameAt(open.start)) {
            if (stack.length === 0) {
              ranges.push({ start: open.start, end });
            }
          }
        }
        i = end === -1 ? n : end + 1;
        continue;
      }
      if (text.startsWith('<!', lt)) {
        // DOCTYPE etc. — skip to matching '>' (naive, no internal subset support)
        const end = text.indexOf('>', lt + 2);
        i = end === -1 ? n : end + 1;
        continue;
      }

      // Opening tag
      const gt = this.findTagEnd(lt + 1);
      if (gt === -1) {
        logger.warn('Unterminated XML tag; stopping scan', { at: lt });
        break;
      }
      const selfClosing = text[gt - 1] === '/';
      const tagName = this.tagNameAt(lt);
      if (tagName && (!recordStartTag || tagName === recordStartTag || stack.length > 0)) {
        if (!selfClosing) {
          stack.push({ start: lt, tag: tagName });
        } else if (stack.length === 0) {
          ranges.push({ start: lt, end: gt });
        }
      }
      i = gt + 1;
    }

    return ranges;
  }

  /**
   * Find the '>' that closes the tag starting after `<` at lt, respecting
   * quoted attribute values.
   */
  findTagEnd(from) {
    const text = this.text;
    let quote = null;
    for (let i = from; i < text.length; i++) {
      const ch = text[i];
      if (quote) {
        if (ch === quote) quote = null;
      } else if (ch === '"' || ch === "'") {
        quote = ch;
      } else if (ch === '>') {
        return i;
      }
    }
    return -1;
  }

  /**
   * Direct child element ranges of the element spanning [start, end].
   * Single pass: push every open tag, and when a tag closes at depth 1
   * (its parent is the element itself) record its full range.
   */
  childElements(start, end) {
    const text = this.text;
    const result = [];
    const stack = [{ start, tag: this.tagNameAt(start) }];
    let i = start + 1;

    while (i <= end && stack.length > 0) {
      const lt = text.indexOf('<', i);
      if (lt === -1 || lt > end) break;

      if (text.startsWith('<!--', lt)) {
        const e = text.indexOf('-->', lt + 4);
        i = e === -1 ? end + 1 : e + 3;
        continue;
      }
      if (text.startsWith('<![CDATA[', lt)) {
        const e = text.indexOf(']]>', lt + 9);
        i = e === -1 ? end + 1 : e + 3;
        continue;
      }
      if (text.startsWith('<?', lt)) {
        const e = text.indexOf('?>', lt + 2);
        i = e === -1 ? end + 1 : e + 2;
        continue;
      }
      if (text.startsWith('</', lt)) {
        const gt = text.indexOf('>', lt + 2);
        const tag = gt === -1 ? null : /^<\/([A-Za-z_:][A-Za-z0-9_:.:-]*)/.exec(text.slice(lt, gt + 1));
        const open = stack.pop();
        if (open && gt !== -1 && tag && tag[1] === open.tag && stack.length === 1) {
          // a direct child closed: stack back at the parent element
          result.push({ start: open.start, end: gt });
        }
        i = gt === -1 ? end + 1 : gt + 1;
        continue;
      }

      const gt = this.findTagEnd(lt + 1);
      if (gt === -1 || gt > end) break;
      const selfClosing = text[gt - 1] === '/';
      const tagName = this.tagNameAt(lt);
      if (tagName) {
        if (selfClosing && stack.length === 1) {
          result.push({ start: lt, end: gt });
        } else if (!selfClosing) {
          stack.push({ start: lt, tag: tagName });
        }
      }
      i = gt + 1;
    }

    return result;
  }
}
