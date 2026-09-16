/**
 * Architxt master bank settings service.
 *
 * Stores the single-row default configuration that is later pushed/pulled to
 * individual Hindsight memory banks. All operations are local to the Architxt
 * database (bank_settings table).
 */

import { createLogger } from '../utils/logger.js';
import { db } from '../db/connection.js';
import { stmt } from '../cache.js';
import { normalizeText } from '../services/hindsight/bank-config.js';

const logger = createLogger('bank-settings');

export const DEFAULT_BANK_SETTINGS = {
  retain_mission: normalizeText(`Extract every discrete architectural fact from this IT component design as a separate, atomic statement. Do not combine multiple facts into one. Do not summarize broadly.

For each specific, singular piece of information, capture exactly one of the following:

1. COMPONENTS: A single system, service, database, or external integration. Use entity labels [[Name (ID)]] when present. Components by themselves (i.e. just being present) is NOT a fact.
2. INTERFACES: One API endpoint, data format, file pattern, or parameter — not a list of endpoints. Extract each interface flow direction as a discreet, separate fact.
3. DATA FLOWS: One directional relationship — which specific component produces data and which specific component consumes it. Use explicit language: sends to, receives from, exchanges with.
4. RISKS & CONSTRAINTS: One performance limit, size limit, vendor gap, or regulatory requirement.
5. SIZING: One data volume, collection size, or throughput figure.
6. SYSTEM PURPOSE & CAPABILITIES: What business or technical capability the system provides, what problem it solves in the architecture, and what role it plays (e.g., canonical source, integration hub, customer-facing portal, reporting layer, data warehouse). If the source text states what would break or degrade if this system were unavailable, capture that as a separate purpose fact.

Rules:
- DO NOT capture individual field names, column names, row values or field definitions unless there are directly related to an architectural component, interface, dataflow or decision.
- Separate facts per component connections - e.g. If a component has 5 connections, extract 5 separate data-flow facts, not 1 summary fact.
- Separate facts per interface - e.g. If a system exposes 3 API endpoints, extract 3 separate interface facts.
- Separate facts per sizing, amounts, totals - e.g. If a table lists 4 sizing figures, extract 4 separate sizing facts.
- If a system's purpose or architectural role is described in the source text, extract it as a separate purpose fact. Do not combine purpose with identity or connection facts.
- Each fact must contain exactly one specific piece of information.
- Preserve [[Name (ID)]] bracket notation exactly. Do not paraphrase or rewrite entity references.

Only extract purpose and capability statements that are stated explicitly in the source text. If the document describes what a system does, what it stores, or what downstream processes depend on it, capture that verbatim as a purpose fact. Do not infer, extrapolate, or invent purpose facts — if the source text does not describe a system's architectural role, do not create a purpose fact for it.`),
  observations_mission: normalizeText(`When consolidating related world facts into observations, follow these rules:

1. Preserve [[Name (ID)]] bracket notation exactly. Observations must remain entity-tagged. Include the same [[Name (ID)]] labels from the source world facts so the observation is traversable in the entity graph.

2. Synthesize, do not concatenate. Only create an observation when merging multiple related facts genuinely produces a richer insight or reveals a cross-system pattern. Do not create observations that merely join atomic facts with commas or "and" — leave those as separate world facts.

3. Exclude temporal and procedural noise. Strip migration timelines, phase references ("before/after"), "intent", "recommendation", "should", and "may" language. Observations must state what is, not what is planned or advised.

4. Prefer architectural relationships over restatements. Prioritize observations that describe cross-system data flows, dependency chains, or architectural trade-offs. Avoid observations that only restate identity, sizing, or deployment counts already captured in world facts.`),
  reflect_mission: normalizeText(`You are a senior IT Architect. Your purpose is to surface architectural components, interfaces and interactions in a concise, accurate and consistent way.`),
  entities_allow_free_form: false,
  disposition: { empathy: 1, literalism: 4, skepticism: 1 },
  retain_extraction_mode: 'verbose',
  retain_chunk_size: 2000,
};

const EXTRACTION_MODES = ['concise', 'verbose', 'custom', 'verbatim', 'chunks'];

function normalizeSettings(row) {
  if (!row) return null;
  let disposition = DEFAULT_BANK_SETTINGS.disposition;
  try {
    disposition = JSON.parse(row.disposition);
  } catch (err) {
    logger.warn('Failed to parse stored disposition', { error: err.message, raw: row.disposition });
  }

  const mode = EXTRACTION_MODES.includes(row.retain_extraction_mode)
    ? row.retain_extraction_mode
    : DEFAULT_BANK_SETTINGS.retain_extraction_mode;

  const chunkSize = Number.isInteger(row.retain_chunk_size) && row.retain_chunk_size > 0
    ? row.retain_chunk_size
    : DEFAULT_BANK_SETTINGS.retain_chunk_size;

  return {
    retain_mission: normalizeText(row.retain_mission ?? DEFAULT_BANK_SETTINGS.retain_mission),
    observations_mission: normalizeText(row.observations_mission ?? DEFAULT_BANK_SETTINGS.observations_mission),
    reflect_mission: normalizeText(row.reflect_mission ?? DEFAULT_BANK_SETTINGS.reflect_mission),
    entities_allow_free_form: row.entities_allow_free_form === 1 || row.entities_allow_free_form === true,
    disposition,
    retain_extraction_mode: mode,
    retain_chunk_size: chunkSize,
  };
}

export function getBankSettings() {
  const row = stmt(db, 'SELECT * FROM bank_settings WHERE bs_id = 1').get();
  if (!row) {
    logger.warn('bank_settings row missing — returning defaults');
    return { success: true, settings: { ...DEFAULT_BANK_SETTINGS } };
  }
  return { success: true, settings: normalizeSettings(row) };
}

export function updateBankSettings(payload) {
  const dispositionJson = JSON.stringify(payload.disposition ?? DEFAULT_BANK_SETTINGS.disposition);
  const sql = `
    INSERT INTO bank_settings (bs_id, retain_mission, observations_mission, reflect_mission, disposition, retain_extraction_mode, retain_chunk_size, entities_allow_free_form)
    VALUES (1, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(bs_id) DO UPDATE SET
      retain_mission = excluded.retain_mission,
      observations_mission = excluded.observations_mission,
      reflect_mission = excluded.reflect_mission,
      disposition = excluded.disposition,
      retain_extraction_mode = excluded.retain_extraction_mode,
      retain_chunk_size = excluded.retain_chunk_size,
      entities_allow_free_form = excluded.entities_allow_free_form,
      bs_updated_at = CURRENT_TIMESTAMP
  `;
  stmt(db, sql).run(
    normalizeText(payload.retain_mission ?? DEFAULT_BANK_SETTINGS.retain_mission),
    normalizeText(payload.observations_mission ?? DEFAULT_BANK_SETTINGS.observations_mission),
    normalizeText(payload.reflect_mission ?? DEFAULT_BANK_SETTINGS.reflect_mission),
    dispositionJson,
    payload.retain_extraction_mode ?? DEFAULT_BANK_SETTINGS.retain_extraction_mode,
    payload.retain_chunk_size ?? DEFAULT_BANK_SETTINGS.retain_chunk_size,
    payload.entities_allow_free_form === true ? 1 : 0
  );
  logger.info('Updated bank_settings master defaults');
  return { success: true, settings: { ...payload } };
}

export function resetBankSettings() {
  stmt(db, 'DELETE FROM bank_settings WHERE bs_id = 1').run();
  const result = updateBankSettings({ ...DEFAULT_BANK_SETTINGS });
  logger.info('Reset bank_settings to defaults');
  return result;
}
