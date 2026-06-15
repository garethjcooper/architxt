#!/usr/bin/env node
/**
 * Database Management Script
 * ============================
 * 
 * Usage:
 *   node scripts/init-db.js           ← Check / create schema (safe, non-destructive)
 *   node scripts/init-db.js --force   ← DESTROY existing DB and recreate from scratch
 * 
 * The server auto-creates schema on first boot, so you rarely need to run this.
 * Use --force only when you want to wipe ALL data and start fresh.
 */

import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { config } from '../src/config.js';
import { resetSchema } from '../src/db/ensure-schema.js';
import { resetSeedData } from '../src/db/ensure-seed.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.join(__dirname, '..');

const dbPath = config.database.path;
const force = process.argv.includes('--force');

console.log('architxt Database Manager');
console.log(`DB Path: ${dbPath}`);
console.log(`Force reset: ${force}`);
console.log('');

// Ensure data directory exists
const dataDir = path.dirname(dbPath);
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
  console.log(`Created directory: ${dataDir}`);
}

// Open database
const db = new Database(dbPath);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

if (force) {
  console.log('');
  console.log('╔══════════════════════════════════════════════════╗');
  console.log('║  ⚠️  FORCE MODE: ALL DATA WILL BE DELETED        ║');
  console.log('╚══════════════════════════════════════════════════╝');
  console.log('');
  resetSchema(db);
} else {
  // Non-destructive: just ensure schema exists
  const { ensureSchema } = await import('../src/db/ensure-schema.js');
  const created = ensureSchema(db);
  if (!created) {
    console.log('Database schema already exists. Nothing to do.');
    console.log('');
    console.log('To reset and delete all data, run:');
    console.log('  node scripts/init-db.js --force');
  }
}

db.close();
console.log('');
console.log('Done.');
