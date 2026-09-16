import { Router } from 'express';
import { createLogger } from '../utils/logger.js';
import { sendResponse } from '../utils/route-helpers.js';
import {
  getBankSettings,
  updateBankSettings,
  resetBankSettings,
  DEFAULT_BANK_SETTINGS,
} from '../services/bank-settings.js';

const logger = createLogger('bank-settings-route');
const router = Router();

const EXTRACTION_MODES = ['concise', 'verbose', 'custom', 'verbatim', 'chunks'];

function validateSettingsBody(req, res, start) {
  const body = req.body;
  const errors = [];

  if (typeof body.retain_mission !== 'string') errors.push('retain_mission must be a string');
  if (typeof body.observations_mission !== 'string') errors.push('observations_mission must be a string');
  if (typeof body.reflect_mission !== 'string') errors.push('reflect_mission must be a string');
  if (!EXTRACTION_MODES.includes(body.retain_extraction_mode)) {
    errors.push(`retain_extraction_mode must be one of ${EXTRACTION_MODES.join(', ')}`);
  }
  if (typeof body.retain_chunk_size !== 'number' || !Number.isInteger(body.retain_chunk_size) || body.retain_chunk_size < 1) {
    errors.push('retain_chunk_size must be a positive integer');
  }
  if (typeof body.entities_allow_free_form !== 'boolean') {
    errors.push('entities_allow_free_form must be a boolean');
  }
  if (!body.disposition || typeof body.disposition !== 'object') {
    errors.push('disposition must be an object');
  } else {
    for (const trait of ['empathy', 'literalism', 'skepticism']) {
      const value = body.disposition[trait];
      if (typeof value !== 'number' || !Number.isInteger(value) || value < 1 || value > 5) {
        errors.push(`disposition.${trait} must be an integer between 1 and 5`);
      }
    }
  }

  if (errors.length > 0) {
    const duration = Date.now() - start;
    sendResponse({
      res, status: 400,
      error: errors.join('; '),
      code: 'VALIDATION_ERROR',
      logger, method: req.method, path: '/bank-settings', duration,
    });
    return null;
  }

  return {
    retain_mission: body.retain_mission,
    observations_mission: body.observations_mission,
    reflect_mission: body.reflect_mission,
    retain_extraction_mode: body.retain_extraction_mode,
    retain_chunk_size: body.retain_chunk_size,
    entities_allow_free_form: body.entities_allow_free_form,
    disposition: {
      empathy: body.disposition.empathy,
      literalism: body.disposition.literalism,
      skepticism: body.disposition.skepticism,
    },
  };
}

/**
 * @openapi
 * /bank-settings:
 *   get:
 *     summary: Get Architxt master bank settings
 *     description: |
 *       Returns the current Architxt master bank settings from the local
 *       bank_settings table. These values are used as defaults when pushing to
 *       or pulling from a Hindsight memory bank.
 *     tags: [Bank Config]
 *     responses:
 *       200:
 *         description: Master bank settings
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 settings: { $ref: '#/components/schemas/BankSettings' }
 *                 defaults: { $ref: '#/components/schemas/BankSettings' }
 *       500:
 *         description: Internal error
 */
router.get('/', async (req, res) => {
  const start = Date.now();
  const result = getBankSettings();
  if (!result.success) {
    const duration = Date.now() - start;
    sendResponse({
      res, status: 500,
      error: result.error,
      code: 'INTERNAL_ERROR',
      logger, method: 'GET', path: '/bank-settings', duration,
    });
    return;
  }

  const duration = Date.now() - start;
  sendResponse({
    res, status: 200,
    data: { settings: result.settings, defaults: { ...DEFAULT_BANK_SETTINGS } },
    logger, method: 'GET', path: '/bank-settings', duration,
  });
});

/**
 * @openapi
 * /bank-settings:
 *   put:
 *     summary: Update Architxt master bank settings
 *     description: |
 *       Saves the master bank settings to the local bank_settings table.
 *       Hindsight bank push/pull is handled separately.
 *     tags: [Bank Config]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/BankSettings'
 *     responses:
 *       200:
 *         description: Settings saved
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success: { type: boolean }
 *                 settings: { $ref: '#/components/schemas/BankSettings' }
 *       400:
 *         description: Validation error
 */
router.put('/', async (req, res) => {
  const start = Date.now();
  const payload = validateSettingsBody(req, res, start);
  if (!payload) return;

  const result = updateBankSettings(payload);
  if (!result.success) {
    const duration = Date.now() - start;
    sendResponse({
      res, status: 500,
      error: result.error,
      code: 'INTERNAL_ERROR',
      logger, method: 'PUT', path: '/bank-settings', duration,
    });
    return;
  }

  const duration = Date.now() - start;
  sendResponse({
    res, status: 200,
    data: { success: true, settings: result.settings },
    logger, method: 'PUT', path: '/bank-settings', duration,
  });
});

/**
 * @openapi
 * /bank-settings:
 *   delete:
 *     summary: Reset bank settings to Architxt defaults
 *     description: |
 *       Clears the local bank_settings row and re-inserts the built-in default
 *       values. This is the backend action for the reset-to-defaults button.
 *     tags: [Bank Config]
 *     responses:
 *       200:
 *         description: Settings reset to defaults
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success: { type: boolean }
 *                 settings: { $ref: '#/components/schemas/BankSettings' }
 */
router.delete('/', async (req, res) => {
  const start = Date.now();
  const result = resetBankSettings();
  if (!result.success) {
    const duration = Date.now() - start;
    sendResponse({
      res, status: 500,
      error: result.error,
      code: 'INTERNAL_ERROR',
      logger, method: 'DELETE', path: '/bank-settings', duration,
    });
    return;
  }

  const duration = Date.now() - start;
  sendResponse({
    res, status: 200,
    data: { success: true, settings: result.settings, defaults: { ...DEFAULT_BANK_SETTINGS } },
    logger, method: 'DELETE', path: '/bank-settings', duration,
  });
});

export default router;
