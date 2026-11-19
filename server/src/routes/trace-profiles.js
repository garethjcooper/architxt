import { Router } from 'express';
import { createLogger } from '../utils/logger.js';
import { db } from '../db/connection.js';
import { handleCrudResult, sendResponse, validateId } from '../utils/route-helpers.js';
import {
  getTraceProfile,
  getTraceProfileByName,
  listTraceProfiles,
  createTraceProfile,
  updateTraceProfile,
  deleteTraceProfile
} from '../db/crud/trace-profiles.js';
import { listEngineManifests, createParserForProfile, isEnginePayloadModule } from '../services/trace/parser-registry.js';
import { suggestTraceProfileConfig } from '../services/trace/trace-profile-suggest.js';
import { discoverFieldExtractionRules, applyFieldExtractionToRecords, stripFieldExtractionSamples, buildValueHistogram } from '../services/trace/trace-field-extract.js';
import { mineSequences } from '../services/trace/sequence-miner.js';
import { analyzeDelimitedSource } from '../services/trace/parsers/delimited-normaliser.js';

const logger = createLogger('trace-profiles-route');
const router = Router();

const toApiProfile = (dbRow) => ({
  id: dbRow.tfp_id,
  name: dbRow.tfp_name,
  description: dbRow.tfp_description,
  config: dbRow.tfp_config || {},
  versions: dbRow.tfp_versions || [],
  usedVersionId: dbRow.tfp_used_version_id ?? null,
  config_updated_at: dbRow.tfp_config_updated_at ?? null,
  created_at: dbRow.tfp_created_at,
  updated_at: dbRow.tfp_updated_at
});

function configsAreEqual(a, b) {
  return JSON.stringify(a) === JSON.stringify(b);
}

function configHasChanged(newConfig, existingRow) {
  if (!existingRow) return true;
  const existingConfig = existingRow.tfp_config || {};
  return !configsAreEqual(newConfig, existingConfig);
}

router.post('/suggest-config', async (req, res) => {
  const start = Date.now();
  const routePath = '/trace-profiles/suggest-config';
  const { sample, currentConfig, coverageResult, sampleBudget } = req.body || {};

  if (typeof sample !== 'string' || sample.trim() === '') {
    sendResponse({ res, status: 400, error: 'sample string is required', code: 'VALIDATION_ERROR', logger, method: 'POST', path: routePath, duration: Date.now() - start });
    return;
  }

  try {
    const suggestion = await suggestTraceProfileConfig(sample, { currentConfig, coverageResult, sampleBudget });
    sendResponse({
      res,
      status: 200,
      data: suggestion,
      logger,
      method: 'POST',
      path: routePath,
      duration: Date.now() - start,
    });
  } catch (err) {
    logger.error('Suggest config failed', { error: err.message });
    sendResponse({
      res,
      status: 500,
      error: err.message,
      code: 'INTERNAL_ERROR',
      logger,
      method: 'POST',
      path: routePath,
      duration: Date.now() - start,
    });
  }
});

router.get('/engines', async (_req, res) => {
  const start = Date.now();
  try {
    const engines = listEngineManifests();
    sendResponse({ res, status: 200, data: { engines }, logger, method: 'GET', path: '/trace-profiles/engines', duration: Date.now() - start });
  } catch (err) {
    logger.error('Failed to list trace engines', { error: err.message });
    sendResponse({ res, status: 500, error: 'Failed to list trace engines', code: 'INTERNAL_ERROR', logger, method: 'GET', path: '/trace-profiles/engines', duration: Date.now() - start });
  }
});

router.post('/extract-fields', async (req, res) => {
  const start = Date.now();
  const routePath = '/trace-profiles/extract-fields';
  const { profileId, rows, sample, existingRules, parserConfig } = req.body || {};

  const hasProfileId = profileId !== undefined && profileId !== null && profileId !== '';
  let numericProfileId = null;
  if (hasProfileId) {
    numericProfileId = Number(profileId);
    if (!Number.isFinite(numericProfileId) || numericProfileId <= 0) {
      sendResponse({ res, status: 400, error: 'profileId must be a positive integer', code: 'VALIDATION_ERROR', logger, method: 'POST', path: routePath, duration: Date.now() - start });
      return;
    }
  }

  const hasRows = Array.isArray(rows) && rows.length > 0;
  const hasSample = typeof sample === 'string' && sample.trim().length > 0;
  if (!hasRows && !hasSample) {
    sendResponse({ res, status: 400, error: 'rows array or sample string is required', code: 'VALIDATION_ERROR', logger, method: 'POST', path: routePath, duration: Date.now() - start });
    return;
  }

  // Delimited extraction derives column names from the raw sample (the row
  // parser strips the header). When no sample is available, fall back to
  // running the delimited parser over the rows' raw text so columns are
  // still produced deterministically.
  let effectiveSample = sample;
  if (parserConfig?.module === 'delimited' && !hasSample && hasRows) {
    effectiveSample = rows.map((r) => r?.raw).filter((r) => typeof r === 'string').join('\n');
  }
  if (parserConfig?.module === 'delimited' && !(typeof effectiveSample === 'string' && effectiveSample.trim().length > 0)) {
    sendResponse({ res, status: 400, error: 'delimited extraction requires the raw sample string to derive header names', code: 'VALIDATION_ERROR', logger, method: 'POST', path: routePath, duration: Date.now() - start });
    return;
  }

  let currentConfig = {};
  if (numericProfileId != null) {
    let profileResult;
    try {
      profileResult = await getTraceProfile(db, numericProfileId);
    } catch (err) {
      logger.error('Failed to read trace profile for field extraction', { profileId, error: err.message });
      sendResponse({ res, status: 500, error: 'Failed to read trace profile', code: 'INTERNAL_ERROR', logger, method: 'POST', path: routePath, duration: Date.now() - start });
      return;
    }

    if (!profileResult || !profileResult.success) {
      sendResponse({ res, status: 500, error: profileResult?.error || 'Failed to read trace profile', code: 'INTERNAL_ERROR', logger, method: 'POST', path: routePath, duration: Date.now() - start });
      return;
    }
    if (!profileResult.data) {
      sendResponse({ res, status: 404, error: 'Trace profile not found', code: 'NOT_FOUND', logger, method: 'POST', path: routePath, duration: Date.now() - start });
      return;
    }
    currentConfig = profileResult.data.tfp_config || {};
  }

  const baseRules = existingRules !== undefined && existingRules !== null
    ? existingRules
    : (currentConfig.fieldExtraction || null);

  try {
    const { fieldExtraction, matched } = await discoverFieldExtractionRules(rows, baseRules, { parserConfig, sample: effectiveSample, force: true });

    if (numericProfileId != null) {
      const newConfig = {
        ...currentConfig,
        fieldExtraction: stripFieldExtractionSamples(fieldExtraction),
      };

      const updated = await updateTraceProfile(db, numericProfileId, {
        tfp_config: newConfig,
        tfp_config_updated_at: new Date().toISOString(),
      });

      if (!updated.success || !updated.data) {
        sendResponse({ res, status: 500, error: updated?.error || 'Failed to persist field extraction rules', code: 'PERSIST_FAILED', logger, method: 'POST', path: routePath, duration: Date.now() - start });
        return;
      }
    }

    sendResponse({
      res,
      status: 200,
      data: { fieldExtraction, matched, persisted: numericProfileId != null },
      logger,
      method: 'POST',
      path: routePath,
      duration: Date.now() - start,
    });
  } catch (err) {
    logger.error('Field extraction failed', { profileId, error: err.message });
    sendResponse({
      res,
      status: 500,
      error: err.message,
      code: 'FIELD_EXTRACTION_FAILED',
      logger,
      method: 'POST',
      path: routePath,
      duration: Date.now() - start,
    });
  }
});

// Preview the deterministic value-histogram pre-stage for field discovery.
// Runs the parser over the sample and returns the histogram entries the LLM
// would receive, plus the effective knobs — no LLM call, so it's fast and
// free to iterate on the thresholds.
router.post('/discovery-histogram', async (req, res) => {
  const start = Date.now();
  const routePath = '/trace-profiles/discovery-histogram';
  const { config: profileConfig, sample, options } = req.body || {};

  if (!profileConfig || typeof profileConfig !== 'object') {
    sendResponse({ res, status: 400, error: 'config object is required', code: 'VALIDATION_ERROR', logger, method: 'POST', path: routePath, duration: Date.now() - start });
    return;
  }
  if (typeof sample !== 'string' || sample.length === 0) {
    sendResponse({ res, status: 400, error: 'sample string is required', code: 'VALIDATION_ERROR', logger, method: 'POST', path: routePath, duration: Date.now() - start });
    return;
  }

  try {
    const parser = createParserForProfile({ tfp_config: profileConfig });
    const records = await parser.parseFile('sample', sample);
    const rows = records.map((r) => ({ raw: typeof r.raw === 'string' ? r.raw : JSON.stringify(r) }));
    const inputLines = sample.split(/\r?\n/).filter((l) => l.trim().length > 0).length;
    const unparsedRecords = records.filter((r) => r.unparsed).length;

    const knobs = {
      minSupport: Number(options?.minSupport) || undefined,
      minSupportPct: options?.minSupportPct !== undefined ? Number(options.minSupportPct) : undefined,
      constantRatio: options?.constantRatio !== undefined ? Number(options.constantRatio) : undefined,
      maxEntries: Number(options?.maxEntries) || undefined,
      contextChars: Number(options?.contextChars) || undefined,
      minTokenLength: Number(options?.minTokenLength) || undefined,
      includeShapes: Array.isArray(options?.includeShapes) ? options.includeShapes.map(String) : undefined,
      stopwords: Array.isArray(options?.stopwords) ? options.stopwords.map(String) : (options?.stopwords === false ? [] : undefined),
    };
    // Strip undefined so buildValueHistogram defaults apply per-knob.
    const cleanKnobs = Object.fromEntries(Object.entries(knobs).filter(([, v]) => v !== undefined && Number.isFinite(v)));

    const histogram = buildValueHistogram(rows, cleanKnobs);

    sendResponse({
      res,
      status: 200,
      data: {
        valid: true,
        totalRecords: records.length,
        parsedRows: rows.length,
        inputLines,
        unparsedRecords,
        knobs: { minSupport: 2, minSupportPct: 0, constantRatio: 0.9, maxEntries: 60, contextChars: 120, minTokenLength: 2, includeShapes: null, stopwords: "default", ...cleanKnobs },
        entries: histogram.entries,
        totalRowsScanned: histogram.totalRows,
        totalCandidates: histogram.totalCandidates,
        truncated: histogram.truncated,
      },
      logger,
      method: 'POST',
      path: routePath,
      duration: Date.now() - start,
    });
  } catch (err) {
    logger.warn('Discovery histogram preview failed', { error: err.message });
    sendResponse({
      res,
      status: 200,
      data: {
        valid: false,
        error: err.message,
        entries: [],
        totalRowsScanned: 0,
        totalCandidates: 0,
        truncated: false,
      },
      logger,
      method: 'POST',
      path: routePath,
      duration: Date.now() - start,
    });
  }
});

router.post('/validate', async (req, res) => {
  const start = Date.now();
  const routePath = '/trace-profiles/validate';
  const { config: profileConfig, sample } = req.body || {};

  if (!profileConfig || typeof profileConfig !== 'object') {
    sendResponse({ res, status: 400, error: 'config object is required', code: 'VALIDATION_ERROR', logger, method: 'POST', path: routePath, duration: Date.now() - start });
    return;
  }
  if (typeof sample !== 'string') {
    sendResponse({ res, status: 400, error: 'sample string is required', code: 'VALIDATION_ERROR', logger, method: 'POST', path: routePath, duration: Date.now() - start });
    return;
  }

  try {
    const parser = createParserForProfile({ tfp_config: profileConfig });
    const { records } = parser.applyRecordSizeCap(await parser.parseFile('sample', sample));
    const totalRecords = records.length;
    const matched = records.filter((r) => !r.unparsed).length;
    const unmatched = totalRecords - matched;
    const coverage = totalRecords > 0 ? Math.min(100, Math.round((matched / totalRecords) * 1000) / 10) : 0;
    const unparsedSamples = records
      .filter((r) => r.unparsed)
      .slice(0, 10)
      .map((r) => r.raw);

    const enriched = applyFieldExtractionToRecords(records, profileConfig.fieldExtraction, {
      enginePayload: isEnginePayloadModule(profileConfig.parser?.module),
    });
    const availableFields = Array.from(new Set(
      enriched.flatMap((r) => Object.keys(r.fields || {}))
    ));

    // Per-field stats over the enriched records: ordinal, name, presence,
    // sparseness, a sample value, and unique counts. Delimited columns keep
    // their positional index so the UI can show column_N placeholders.
    const fieldStats = [];
    const fieldIndex = new Map();
    for (const field of availableFields) {
      fieldIndex.set(field, fieldStats.length);
      fieldStats.push({
        field,
        index: fieldStats.length,
        present: 0,
        sample: null,
        samples: [],
        uniqueValues: 0,
      });
    }
    for (const record of enriched) {
      const recFields = record.fields || {};
      for (const [field, value] of Object.entries(recFields)) {
        const idx = fieldIndex.get(field);
        if (idx == null) continue;
        const stat = fieldStats[idx];
        const rawText = value == null ? '' : String(value);
        if (rawText !== '') {
          stat.present += 1;
          // Truncate long values instead of dropping them, so even very long
          // header lines still yield a visible sample in the preview.
          const text = rawText.length <= 200 ? rawText : rawText.slice(0, 197) + '...';
          if (stat.sample == null) stat.sample = text;
          // Collect a few unique sample values per field (preview-only) so
          // added/regex fields visibly show what they matched.
          if (stat.samples.length < 5 && !stat.samples.includes(text)) {
            stat.samples.push(text);
          }
        }
      }
    }
    for (const stat of fieldStats) {
      const values = new Set();
      for (const record of enriched) {
        const value = record.fields?.[stat.field];
        if (value != null && String(value) !== '') values.add(String(value));
      }
      stat.uniqueValues = values.size;
    }
    const total = enriched.length;
    for (const stat of fieldStats) {
      stat.sparseness = total > 0 ? Math.round(((total - stat.present) / total) * 1000) / 10 : 0;
      stat.uniquePercent = total > 0 ? Math.round((stat.uniqueValues / Math.max(1, stat.present)) * 1000) / 10 : 0;
    }

    const analysis = profileConfig.parser?.module === 'delimited'
      ? analyzeDelimitedSource(sample, profileConfig.parser.config)
      : { hasMultiLineColumns: false, hasMultipleMultiLineColumns: false, multiLineColumns: [], warnings: [] };

    sendResponse({
      res,
      status: 200,
      data: {
        valid: true,
        totalRecords,
        matched,
        unmatched,
        coverage,
        unparsedSamples,
        records: enriched.slice(0, 500),
        availableFields,
        fieldStats,
        warnings: analysis.warnings,
        multiLineColumns: analysis.multiLineColumns ?? [],
      },
      logger,
      method: 'POST',
      path: routePath,
      duration: Date.now() - start,
    });
  } catch (err) {
    logger.warn('Profile validation failed', { error: err.message });
    sendResponse({
      res,
      status: 200,
      data: {
        valid: false,
        error: err.message,
        totalRecords: 0,
        matched: 0,
        unmatched: 0,
        coverage: 0,
        unparsedSamples: [],
      },
      logger,
      method: 'POST',
      path: routePath,
      duration: Date.now() - start,
    });
  }
});

router.post('/preview-sequences', async (req, res) => {
  const start = Date.now();
  const routePath = '/trace-profiles/preview-sequences';
  const { config: profileConfig, sample } = req.body || {};

  if (!profileConfig || typeof profileConfig !== 'object') {
    sendResponse({ res, status: 400, error: 'config object is required', code: 'VALIDATION_ERROR', logger, method: 'POST', path: routePath, duration: Date.now() - start });
    return;
  }
  if (typeof sample !== 'string') {
    sendResponse({ res, status: 400, error: 'sample string is required', code: 'VALIDATION_ERROR', logger, method: 'POST', path: routePath, duration: Date.now() - start });
    return;
  }

  const parserConfig = profileConfig.parser?.config;
  const sequenceProfile = parserConfig?.sequenceProfile;
  if (!sequenceProfile || typeof sequenceProfile !== 'object') {
    sendResponse({ res, status: 400, error: 'config.parser.config.sequenceProfile is required', code: 'VALIDATION_ERROR', logger, method: 'POST', path: routePath, duration: Date.now() - start });
    return;
  }

  try {
    const parser = createParserForProfile({ tfp_config: profileConfig });
    const { records } = parser.applyRecordSizeCap(await parser.parseFile('sample', sample));
    const parsedRecords = applyFieldExtractionToRecords(
      records.filter((r) => !r.unparsed),
      profileConfig.fieldExtraction,
      { enginePayload: isEnginePayloadModule(profileConfig.parser?.module) }
    );
    const inputFormat = profileConfig.parser?.module || 'trace';
    const sequenceDocument = mineSequences(parsedRecords, sequenceProfile, {
      filename: 'sample',
      inputFormat,
    });

    sendResponse({
      res,
      status: 200,
      data: {
        valid: true,
        markdown: sequenceDocument.markdown,
        stats: sequenceDocument.stats,
      },
      logger,
      method: 'POST',
      path: routePath,
      duration: Date.now() - start,
    });
  } catch (err) {
    logger.warn('Sequence preview failed', { error: err.message });
    sendResponse({
      res,
      status: 200,
      data: {
        valid: false,
        error: err.message,
        markdown: '',
        stats: null,
      },
      logger,
      method: 'POST',
      path: routePath,
      duration: Date.now() - start,
    });
  }
});

router.get('/', async (req, res) => {
  const start = Date.now();
  const result = await listTraceProfiles(db);
  handleCrudResult({
    res,
    result,
    notFoundError: null,
    successStatus: 200,
    successData: result.success ? result.data.map(toApiProfile) : null,
    logger,
    method: 'GET',
    path: '/trace-profiles',
    start
  });
});

router.get('/by-name/:name', async (req, res) => {
  const start = Date.now();
  const routePath = `/trace-profiles/by-name/${req.params.name}`;
  const name = req.params.name?.trim();
  if (!name) {
    sendResponse({ res, status: 400, error: 'name is required', code: 'VALIDATION_ERROR', logger, method: 'GET', path: routePath, duration: Date.now() - start });
    return;
  }
  const result = await getTraceProfileByName(db, name);
  if (!result.success) {
    sendResponse({ res, status: 500, error: result.error, code: result.code, logger, method: 'GET', path: routePath, duration: Date.now() - start });
    return;
  }
  if (!result.data) {
    sendResponse({ res, status: 404, error: 'Trace profile not found', code: 'NOT_FOUND', logger, method: 'GET', path: routePath, duration: Date.now() - start });
    return;
  }
  sendResponse({ res, status: 200, data: toApiProfile(result.data), logger, method: 'GET', path: routePath, duration: Date.now() - start });
});

router.get('/:id', async (req, res) => {
  const start = Date.now();
  const routePath = `/trace-profiles/${req.params.id}`;
  const idCheck = validateId({ req, res, paramName: 'id', logger, path: routePath, start });
  if (!idCheck.valid) return;
  const result = await getTraceProfile(db, idCheck.id);
  if (!result.success) {
    sendResponse({ res, status: 500, error: result.error, code: result.code, logger, method: 'GET', path: routePath, duration: Date.now() - start });
    return;
  }
  if (!result.data) {
    sendResponse({ res, status: 404, error: 'Trace profile not found', code: 'NOT_FOUND', logger, method: 'GET', path: routePath, duration: Date.now() - start });
    return;
  }
  sendResponse({ res, status: 200, data: toApiProfile(result.data), logger, method: 'GET', path: routePath, duration: Date.now() - start });
});

router.post('/', async (req, res) => {
  const start = Date.now();
  const routePath = '/trace-profiles';
  const { name, description, config: profileConfig, versions, usedVersionId } = req.body || {};
  if (!name || typeof name !== 'string' || name.trim() === '') {
    sendResponse({ res, status: 400, error: 'name is required', code: 'VALIDATION_ERROR', logger, method: 'POST', path: routePath, duration: Date.now() - start });
    return;
  }
  if (!profileConfig || typeof profileConfig !== 'object') {
    sendResponse({ res, status: 400, error: 'config object is required', code: 'VALIDATION_ERROR', logger, method: 'POST', path: routePath, duration: Date.now() - start });
    return;
  }
  if (versions !== undefined && !Array.isArray(versions)) {
    sendResponse({ res, status: 400, error: 'versions must be an array', code: 'VALIDATION_ERROR', logger, method: 'POST', path: routePath, duration: Date.now() - start });
    return;
  }
  if (usedVersionId !== undefined && usedVersionId !== null && !Number.isFinite(usedVersionId)) {
    sendResponse({ res, status: 400, error: 'usedVersionId must be a number or null', code: 'VALIDATION_ERROR', logger, method: 'POST', path: routePath, duration: Date.now() - start });
    return;
  }
  const result = await createTraceProfile(db, {
    tfp_name: name.trim(),
    tfp_description: description || null,
    tfp_config: profileConfig,
    tfp_versions: versions || [],
    tfp_used_version_id: usedVersionId ?? null,
    tfp_config_updated_at: new Date().toISOString()
  });
  if (!result.success) {
    sendResponse({ res, status: 500, error: result.error, code: result.code, logger, method: 'POST', path: routePath, duration: Date.now() - start });
    return;
  }
  sendResponse({ res, status: 201, data: { id: result.data }, logger, method: 'POST', path: routePath, duration: Date.now() - start });
});

router.put('/:id', async (req, res) => {
  const start = Date.now();
  const routePath = `/trace-profiles/${req.params.id}`;
  const idCheck = validateId({ req, res, paramName: 'id', logger, path: routePath, start });
  if (!idCheck.valid) return;
  const fields = [];
  const data = {};
  const { name, description, config: profileConfig, versions, usedVersionId } = req.body || {};
  if (name !== undefined) {
    fields.push('tfp_name');
    data.tfp_name = name;
  }
  if (description !== undefined) {
    fields.push('tfp_description');
    data.tfp_description = description;
  }
  if (profileConfig !== undefined) {
    fields.push('tfp_config');
    data.tfp_config = profileConfig;
  }
  const existingResult = await getTraceProfile(db, idCheck.id);
  if (profileConfig !== undefined && configHasChanged(profileConfig, existingResult.success ? existingResult.data : null)) {
    fields.push('tfp_config_updated_at');
    data.tfp_config_updated_at = new Date().toISOString();
  }
  if (versions !== undefined) {
    if (!Array.isArray(versions)) {
      sendResponse({ res, status: 400, error: 'versions must be an array', code: 'VALIDATION_ERROR', logger, method: 'PUT', path: routePath, duration: Date.now() - start });
      return;
    }
    fields.push('tfp_versions');
    data.tfp_versions = versions;
  }
  if (usedVersionId !== undefined) {
    if (usedVersionId !== null && !Number.isFinite(usedVersionId)) {
      sendResponse({ res, status: 400, error: 'usedVersionId must be a number or null', code: 'VALIDATION_ERROR', logger, method: 'PUT', path: routePath, duration: Date.now() - start });
      return;
    }
    fields.push('tfp_used_version_id');
    data.tfp_used_version_id = usedVersionId === null ? null : Math.floor(usedVersionId);
  }
  if (fields.length === 0) {
    sendResponse({ res, status: 400, error: 'No fields to update', code: 'VALIDATION_ERROR', logger, method: 'PUT', path: routePath, duration: Date.now() - start });
    return;
  }
  const result = await updateTraceProfile(db, idCheck.id, data);
  if (!result.success) {
    sendResponse({ res, status: 500, error: result.error, code: result.code, logger, method: 'PUT', path: routePath, duration: Date.now() - start });
    return;
  }
  sendResponse({ res, status: 200, data: { updated: result.data }, logger, method: 'PUT', path: routePath, duration: Date.now() - start });
});

router.delete('/:id', async (req, res) => {
  const start = Date.now();
  const routePath = `/trace-profiles/${req.params.id}`;
  const idCheck = validateId({ req, res, paramName: 'id', logger, path: routePath, start });
  if (!idCheck.valid) return;
  const result = await deleteTraceProfile(db, idCheck.id);
  if (!result.success) {
    sendResponse({ res, status: 500, error: result.error, code: result.code, logger, method: 'DELETE', path: routePath, duration: Date.now() - start });
    return;
  }
  if (!result.data) {
    sendResponse({ res, status: 404, error: 'Trace profile not found', code: 'NOT_FOUND', logger, method: 'DELETE', path: routePath, duration: Date.now() - start });
    return;
  }
  sendResponse({ res, status: 204, data: null, logger, method: 'DELETE', path: routePath, duration: Date.now() - start });
});

export default router;
