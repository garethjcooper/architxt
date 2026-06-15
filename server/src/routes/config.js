import { Router } from 'express';
import { createLogger } from '../utils/logger.js';
import { config } from '../config.js';
import {
  getActiveFormat,
  getAllFormats,
  ACTIVE_FORMAT_KEY,
  getSyncedFields,
  shouldSyncNameField,
} from '../entity-tag-format.js';
import { execSync } from 'child_process';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const logger = createLogger('config-route');
const router = Router();

/**
 * @openapi
 * /config/entity-format:
 *   get:
 *     summary: Get active entity tag format
 *     description: |
 *       Returns the currently active entity tag format definition and the
 *       full registry of available formats. The UI should call this on
 *       startup and use the returned format for all parse/build/render ops.
 *     tags: [Config]
 *     responses:
 *       200:
 *         description: Active format and registry
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 activeKey:
 *                   type: string
 *                   example: v1-dual
 *                 active:
 *                   type: object
 *                   properties:
 *                     key: { type: string }
 *                     displayName: { type: string }
 *                     regexSource: { type: string }
 *                     presentInIndicator: { type: string, example: "[[" }
 *                 registry:
 *                   type: object
 *                   additionalProperties:
 *                     type: object
 *                     properties:
 *                       key: { type: string }
 *                       displayName: { type: string }
 *                       regexSource: { type: string }
 *                       presentInIndicator: { type: string }
 *       500:
 *         description: Server misconfiguration
 */
router.get('/entity-format', (req, res) => {
  try {
    const active = getActiveFormat();
    const all = getAllFormats();

    // Strip functions from registry — send metadata only
    const stripFunctions = (fmt) => ({
      key: fmt.key,
      displayName: fmt.displayName,
      regexSource: fmt.regex.source,
      regexFlags: fmt.regex.flags,
      presentInIndicator: '[[',
    });

    const registry = {};
    for (const [key, fmt] of Object.entries(all)) {
      registry[key] = stripFunctions(fmt);
    }

    res.json({
      activeKey: ACTIVE_FORMAT_KEY,
      active: stripFunctions(active),
      registry,
    });
  } catch (err) {
    logger.error('entity-format route error', { error: err.message });
    res.status(500).json({ error: err.message, code: 'CONFIG_ERROR' });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// Settings — read-only safe snapshot of currently-effective prompt/docling
// and entity format configuration.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * @openapi
 * /config/settings:
 *   get:
 *     summary: Get current application settings
 *     description: |
 *       Returns a safe read-only snapshot of prompts, docling, entity
 *       tag format, and entity match configuration currently in effect.
 *     tags: [Config]
 *     responses:
 *       200:
 *         description: Settings snapshot
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 prompts:
 *                   type: object
 *                   properties:
 *                     diagram_description:
 *                       type: object
 *                       properties:
 *                         provider:   { type: string }
 *                         model:      { type: string }
 *                         temperature:{ type: number }
 *                         task_prompt:{ type: string }
 *                         system_prompt:{ type: string }
 *                         timeout_ms: { type: number }
 *                         batch_size: { type: number }
 *                         max_batches:{ type: number }
 *                         concurrency:{ type: number }
 *                     document_denoise_llm:
 *                       type: object
 *                       properties:
 *                         provider:   { type: string }
 *                         model:      { type: string }
 *                         temperature:{ type: number }
 *                         task_prompt:{ type: string }
 *                         system_prompt:{ type: string }
 *                         timeout_ms: { type: number }
 *                     document_denoise:
 *                       type: object
 *                       additionalProperties:
 *                         type: object
 *                         properties:
 *                           value: { type: string }
 *                           envVar:{ type: string }
 *                 docling:
 *                   type: object
 *                   properties:
 *                     service_url:
 *                       type: object
 *                       properties:
 *                         value: { type: string }
 *                         envVar:{ type: string }
 *                 entity_tag:
 *                   type: object
 *                   properties:
 *                     active_key:
 *                       type: object
 *                       properties:
 *                         value: { type: string }
 *                         envVar:{ type: string }
 *                     active_name:
 *                       type: object
 *                       properties:
 *                         value: { type: string }
 *                         envVar:{ type: string }
 *                     synced_fields:
 *                       type: object
 *                       properties:
 *                         value: { type: array, items: { type: string } }
 *                         envVar:{ type: string }
 *                     sync_name:
 *                       type: object
 *                       properties:
 *                         value: { type: boolean }
 *                         envVar:{ type: string }
 *                 entity_match:
 *                   type: object
 *                   properties:
 *                     pattern:
 *                       type: object
 *                       properties:
 *                         value: { type: string }
 *                         envVar:{ type: string }
 *                     description:
 *                       type: object
 *                       properties:
 *                         value: { type: string }
 *                         envVar:{ type: string }
 *                 server:
 *                   type: object
 *                   properties:
 *                     port:
 *                       type: object
 *                       properties:
 *                         value: { type: number }
 *                         envVar:{ type: string }
 *                     host:
 *                       type: object
 *                       properties:
 *                         value: { type: string }
 *                         envVar:{ type: string }
 *                     env:
 *                       type: object
 *                       properties:
 *                         value: { type: string }
 *                         envVar:{ type: string }
 *                 ui:
 *                   type: object
 *                   properties:
 *                     port:
 *                       type: object
 *                       properties:
 *                         value: { type: number }
 *                         envVar:{ type: string }
 *                     api_base_url:
 *                       type: object
 *                       properties:
 *                         value: { type: string }
 *                         envVar:{ type: string }
 */
router.get('/settings', (req, res) => {
  try {
    const diag = config.diagram_description || {};
    const denoise = config.document_denoise_llm || {};
    const denoiseBasic = config.document_denoise || {};

    res.json({
      prompts: {
        diagram_description: {
          enabled:     { value: diag.enabled     ?? '—', envVar: 'ARCHITXT_VISION_ENABLED' },
          provider:    { value: diag.provider    || '—', envVar: 'ARCHITXT_VISION_PROVIDER' },
          model:       { value: diag.model       || '—', envVar: 'ARCHITXT_VISION_MODEL' },
          temperature: { value: typeof diag.temperature === 'number' ? diag.temperature : '—', envVar: 'ARCHITXT_DIAGRAM_TEMPERATURE' },
          task_prompt: { value: diag.task_prompt || '', envVar: 'ARCHITXT_VISION_PROMPT' },
          system_prompt:{value: diag.system_prompt|| '', envVar: 'ARCHITXT_VISION_SYSTEM_PROMPT' },
          timeout_ms:  { value: diag.timeout_ms  || '—', envVar: 'ARCHITXT_VISION_TIMEOUT_MS' },
          batch_size:  { value: diag.batch_size || '—', envVar: 'ARCHITXT_DIAGRAM_BATCH_SIZE' },
          max_batches: { value: diag.max_batches|| '—', envVar: 'ARCHITXT_DIAGRAM_MAX_BATCHES' },
          concurrency: { value: diag.concurrency || '—', envVar: 'ARCHITXT_DIAGRAM_CONCURRENCY' },
        },
        document_denoise_llm: {
          enabled:     { value: denoise.enabled     ?? '—', envVar: 'ARCHITXT_DENOISE_LLM_ENABLED' },
          provider:    { value: denoise.provider    || '—', envVar: 'ARCHITXT_DENOISE_LLM_PROVIDER' },
          model:       { value: denoise.model       || '—', envVar: 'ARCHITXT_DENOISE_LLM_MODEL' },
          temperature: { value: typeof denoise.temperature === 'number' ? denoise.temperature : '—', envVar: 'ARCHITXT_DENOISE_LLM_TEMPERATURE' },
          task_prompt: { value: denoise.task_prompt || '', envVar: 'ARCHITXT_DENOISE_LLM_PROMPT' },
          system_prompt:{value: denoise.system_prompt|| '', envVar: 'ARCHITXT_DENOISE_LLM_SYSTEM_PROMPT' },
          timeout_ms:  { value: denoise.timeout_ms  || '—', envVar: 'ARCHITXT_DENOISE_LLM_TIMEOUT_MS' },
        },
        document_denoise: {
          enabled:                     { value: denoiseBasic.enabled                     ?? '—', envVar: 'ARCHITXT_DENOISE_ENABLED' },
          remove_page_numbers:         { value: denoiseBasic.remove_page_numbers         || '—', envVar: 'ARCHITXT_DENOISE_REMOVE_PAGE_NUMBERS' },
          remove_confidential_headers: { value: denoiseBasic.remove_confidential_headers || '—', envVar: 'ARCHITXT_DENOISE_REMOVE_CONFIDENTIAL' },
          remove_document_ids:         { value: denoiseBasic.remove_document_ids         || '—', envVar: 'ARCHITXT_DENOISE_REMOVE_DOC_IDS' },
          unescape_html_entities:      { value: denoiseBasic.unescape_html_entities      || '—', envVar: 'ARCHITXT_DENOISE_UNESCAPE_HTML' },
          normalize_whitespace:        { value: denoiseBasic.normalize_whitespace        || '—', envVar: 'ARCHITXT_DENOISE_NORMALIZE_WS' },
          remove_non_ascii:            { value: denoiseBasic.remove_non_ascii            || '—', envVar: 'ARCHITXT_DENOISE_REMOVE_NON_ASCII' },
          max_consecutive_newlines:    { value: denoiseBasic.max_consecutive_newlines    || '—', envVar: 'ARCHITXT_DENOISE_MAX_NEWLINES' },
        },
      },
      docling: {
        service_url: { value: config.docling?.serviceUrl || '—', envVar: 'DOCLING_SERVICE_URL' },
      },
      entity_tag: {
        active_key:    { value: ACTIVE_FORMAT_KEY,           envVar: '—' },
        active_name:   { value: getActiveFormat().displayName, envVar: '—' },
        synced_fields: { value: getSyncedFields(),           envVar: '—' },
        sync_name:     { value: shouldSyncNameField(),       envVar: '—' },
      },
      entity_match: {
        pattern:     { value: '\\[\\[(.*?)\\s*(?:\\(([^)]*)\\))?\\]\\]', envVar: '—' },
        description: { value: 'Detects both v1-dual [[Text (name, id)]] and v2-single [[Text (id)]]', envVar: '—' },
      },
      server: {
        port: { value: config.server?.port ?? null, envVar: 'ARCHITXT_PORT' },
        host: { value: config.server?.host ?? null, envVar: 'ARCHITXT_HOST' },
        env:  { value: config.server?.env  ?? null, envVar: 'ARCHITXT_NODE_ENV' },
      },
      ui: {
        port:         { value: config.ui?.port       ?? null, envVar: 'ARCHITXT_UI_PORT' },
        api_base_url: { value: config.ui?.apiBaseUrl ?? null, envVar: 'ARCHITXT_UI_API_BASE_URL' },
      },
    });
  } catch (err) {
    logger.error('settings route error', { error: err.message });
    res.status(500).json({ error: err.message, code: 'CONFIG_ERROR' });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// Restart server — trigger pm2 restart for the server process
// ─────────────────────────────────────────────────────────────────────────────

/**
 * @openapi
 * /config/restart:
 *   post:
 *     summary: Restart the server process
 *     description: |
 *       Attempts to restart the server via `pm2 restart` or `npx pm2 restart`.
 *       Returns a success message if the command executed, or 501 if pm2 is
 *       not available in the environment.
 *     tags: [Config]
 *     responses:
 *       200:
 *         description: Restart triggered
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success: { type: boolean }
 *                 message: { type: string }
 *                 method: { type: string }
 *       501:
 *         description: Restart not available (pm2 not found)
 *       500:
 *         description: Restart command failed
 */
router.post('/restart', (req, res) => {
  try {
    const __dirname = dirname(fileURLToPath(import.meta.url));
    const projectRoot = join(__dirname, '..', '..');

    // Try pm2 via npx first (handles local install), then global pm2
    let method = 'npx pm2 restart';
    let stdout;
    try {
      stdout = execSync('npx pm2 restart all', {
        cwd: projectRoot,
        encoding: 'utf-8',
        timeout: 15000,
      });
    } catch (npxErr) {
      try {
        method = 'pm2 restart';
        stdout = execSync('pm2 restart all', {
          cwd: projectRoot,
          encoding: 'utf-8',
          timeout: 15000,
        });
      } catch (pm2Err) {
        logger.warn('Restart attempted but pm2 not available', {
          npxError: npxErr.message,
          pm2Error: pm2Err.message,
        });
        return res.status(501).json({
          error: 'Server restart is not available in this environment. Please restart manually.',
          code: 'RESTART_NOT_AVAILABLE',
        });
      }
    }

    logger.info('Server restart triggered via ' + method, { stdout: stdout.trim() });
    res.json({
      success: true,
      message: 'Server restart triggered. Reload this page in a few seconds.',
      method,
    });
  } catch (err) {
    logger.error('Restart failed unexpectedly', { error: err.message });
    res.status(500).json({ error: err.message, code: 'RESTART_FAILED' });
  }
});

export default router;
