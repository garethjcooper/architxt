import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { createLogger } from '../utils/logger.js';

const logger = createLogger('seed');

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.join(__dirname, '..', '..');
const seedPath = path.join(rootDir, 'sql', 'seed_data.sql');

/**
 * Detect whether system seed data has already been applied
 * by checking for any metadata rows tagged with generated_by='system'.
 */
function hasSeedData(db) {
  try {
    const stmt = db.prepare(`SELECT meta_id FROM metadata WHERE meta_generated_by = 'system' LIMIT 1`);
    const row = stmt.get();
    return !!row;
  } catch {
    return false;
  }
}

/**
 * Apply seed data from server/sql/seed_data.sql if not already present.
 * Called automatically by db/connection.js after schema creation.
 * Safe to run on existing databases — INSERT OR IGNORE skips duplicates.
 */
export function ensureSeedData(db) {
  if (hasSeedData(db)) {
    logger.debug('Seed data already present — skipping');
    return false;
  }

  if (!fs.existsSync(seedPath)) {
    logger.error(`Seed file not found: ${seedPath}`);
    throw new Error(`Missing seed file: ${seedPath}`);
  }

  logger.info('Applying system seed data ...');

  const seedSql = fs.readFileSync(seedPath, 'utf8');
  db.exec(seedSql);

  logger.info('System seed data applied');
  return true;
}

/**
 * Force re-apply seed data regardless of existing state.
 * Used by db:reset or manual recovery.
 */
export function resetSeedData(db) {
  if (!fs.existsSync(seedPath)) {
    logger.error(`Seed file not found: ${seedPath}`);
    throw new Error(`Missing seed file: ${seedPath}`);
  }

  logger.info('Force-applying system seed data ...');

  const seedSql = fs.readFileSync(seedPath, 'utf8');
  db.exec(seedSql);

  logger.info('System seed data reapplied');
  return true;
}
