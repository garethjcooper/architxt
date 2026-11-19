import { DelimitedParser, findRecordStartRows } from './parsers/delimited-parser.js';
import { PlaintextParser, findRecordStartLines } from './parsers/plaintext-parser.js';
import { JsonLinesParser, findJsonObjectBoundaries } from './parsers/json-lines-parser.js';
import { JsonNdParser, findJsonNdObjectBoundaries } from './parsers/json-nd-parser.js';
import { XmlParser, findXmlElementBoundaries } from './parsers/xml-parser.js';
import { validateTraceProfileRegexes } from './regex-compile.js';

/**
 * @typedef {object} TraceEngineManifest
 * @property {string} module - Engine identifier used in profile JSON.
 * @property {string} name - Human-readable label.
 * @property {string} description - Short explanation of when to use the engine.
 * @property {string[]} contentTypes - Suggested file extensions or mime families.
 */

/**
 * Registry of built-in trace format engines.
 *
 * Profiles reference engines by module name. The registry is intentionally
 * small and hardcoded in v1; the LLM-assisted profile builder helps users
 * author configs that target these engines rather than generating arbitrary
 * regex or code at runtime.
 */
const PARSERS = {
  'delimited': DelimitedParser,
  'plaintext': PlaintextParser,
  'json-lines': JsonLinesParser,
  'json-nd': JsonNdParser,
  'xml': XmlParser,
};

/**
 * Human-readable metadata for each engine. This is exposed to the UI and to
 * the LLM-assisted builder so they can only configure engines that exist.
 *
 * @type {Record<string, TraceEngineManifest>}
 */
const MANIFESTS = {
  'delimited': {
    module: 'delimited',
    name: 'Delimited',
    description: 'CSV, TSV, pipe-delimited and similar character-delimited files. Set records.payloadStitching to "xml" or "json" when one column contains multi-line payloads. Supports record-start rules keyed on a leading column.',
    contentTypes: ['.csv', '.tsv', '.txt', 'text/csv', 'text/tab-separated-values'],
  },
  'plaintext': {
    module: 'plaintext',
    name: 'Plaintext log',
    description: 'Line-oriented or multi-line text logs where each record starts with a regex pattern (recordStartPattern). Use when there are no reliable columns/delimiters. Supports XML/JSON payload stitching.',
    contentTypes: ['.log', '.txt', 'text/plain'],
  },
  'json-lines': {
    module: 'json-lines',
    name: 'JSON lines',
    description: 'NDJSON / JSON-lines files where each line or object is independent JSON. Supports dot-path record-start markers.',
    contentTypes: ['.jsonl', '.ndjson', 'application/x-ndjson'],
  },
  'json-nd': {
    module: 'json-nd',
    name: 'JSON document',
    description: 'Pretty-printed JSON files where a single JSON object or array spans multiple lines. For root arrays, each element is treated as a record. Supports dot-path record-start markers and regex variants evaluated against the JSON-serialised record.',
    contentTypes: ['.json', 'application/json'],
  },
  'xml': {
    module: 'xml',
    name: 'XML document',
    description: 'Whole-file XML documents and streams of concatenated XML elements. A root element wrapping repeated children (e.g. <log><event/>…) is split so each child is a record; concatenated top-level elements are split per element. Set records.splitElements to false to keep the whole document as one record, or records.recordStartTag to only accept elements with that tag name.',
    contentTypes: ['.xml', 'text/xml', 'application/xml'],
  },
};

/**
 * Get a parser class by engine name.
 *
 * @param {string} moduleName
 * @returns {typeof import('./parsers/base-parser.js').BaseTraceParser | undefined}
 */
export function getParserClass(moduleName) {
  return PARSERS[moduleName];
}

/**
 * Get the manifest for a single engine.
 *
 * @param {string} moduleName
 * @returns {TraceEngineManifest | undefined}
 */
export function getEngineManifest(moduleName) {
  return MANIFESTS[moduleName];
}

/**
 * List all available engine manifests.
 *
 * @returns {TraceEngineManifest[]}
 */
export function listEngineManifests() {
  return Object.values(MANIFESTS);
}

/**
 * Get a record-boundary detector for an engine.
 *
 * Detectors take `(lines, parserConfig)` and return an array of
 * `{ startLine, endLine }` ranges covering logical records.
 *
 * @param {string} moduleName
 * @returns {((lines: string[], config: object) => Array<{startLine: number, endLine: number}>) | undefined}
 */
export function getRecordBoundaryDetector(moduleName) {
  switch (moduleName) {
    case 'plaintext':
      return findRecordStartLines;
    case 'delimited':
      return findRecordStartRows;
    case 'json-lines':
      return findJsonObjectBoundaries;
    case 'json-nd':
      return findJsonNdObjectBoundaries;
    case 'xml':
      return findXmlElementBoundaries;
    default:
      return undefined;
  }
}

/**
 * Instantiate a parser for the given profile.
 *
 * @param {object} profile - Trace profile row (must have tfp_config.parser.module).
 * @returns {import('./parsers/base-parser.js').BaseTraceParser}
 */
export function createParserForProfile(profile) {
  const config = profile?.tfp_config || {};
  // Fail fast: every profile regex is compiled and validated once here, so an
  // invalid pattern surfaces at profile-load instead of per record mid-parse.
  validateTraceProfileRegexes(config);
  const rawModuleName = config?.parser?.module;
  const moduleName = normalizeEngineName(rawModuleName);
  const ParserClass = getParserClass(moduleName);
  if (!ParserClass) {
    throw new Error(`Unknown trace parser engine: ${rawModuleName}`);
  }
  return new ParserClass(config.parser?.config || {});
}

function normalizeEngineName(name) {
  if (!name || typeof name !== 'string') return '';
  return name.replace(/^architxt\.parsers\./, '');
}

/**
 * True for engines whose records are whole-record JSON/XML values
 * (json-lines, json-nd, xml). Field extraction expands their payload fields
 * at apply time; delimited/plaintext stitch payloads onto a header and skip
 * expansion.
 */
export function isEnginePayloadModule(moduleName) {
  return ['json-lines', 'json-nd', 'xml'].includes(normalizeEngineName(moduleName));
}

/**
 * List available parser engine names.
 *
 * @returns {string[]}
 */
export function listParserModules() {
  return Object.keys(PARSERS);
}
