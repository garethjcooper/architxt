#!/usr/bin/env node
/**
 * architxt Clean Script
 * ======================
 *
 * Resets all runtime data while keeping code and dependencies intact.
 *
 * What it removes:
 *   - database/      → SQLite DB and WAL files
 *   - documents/     → Uploaded files and conversions
 *   - logs/          → Application logs
 *   - tmp/           → Temporary processing files
 *   - ui/dist/       → Built static UI artifacts
 *
 * What it preserves:
 *   - Source code, config files, .env
 *   - node_modules (no reinstall needed)
 *
 * After running:
 *   npm run setup   → Recreates empty DB + seed data
 *   npm run build   → Rebuilds the UI
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.join(__dirname, '..');

function log(msg) {
  console.log(`[clean] ${msg}`);
}

function rmDir(dir) {
  const fullPath = path.join(rootDir, dir);
  if (fs.existsSync(fullPath)) {
    fs.rmSync(fullPath, { recursive: true, force: true });
    log(`Removed: ${dir}/`);
  } else {
    log(`Already gone: ${dir}/`);
  }
}

console.log('');
console.log('╔══════════════════════════════════════════════════╗');
console.log('║      architxt — Clean Runtime Data                ║');
console.log('╠══════════════════════════════════════════════════╣');
console.log('║  Removes: database/, documents/, logs/, tmp/      ║');
console.log('║           ui/dist/                                ║');
console.log('║  Keeps:   Source code, .env, node_modules         ║');
console.log('╚══════════════════════════════════════════════════╝');
console.log('');

const targets = ['database', 'documents', 'logs', 'tmp', path.join('ui', 'dist')];

for (const target of targets) {
  rmDir(target);
}

log('Done.');
console.log('');
console.log('Next steps:');
console.log('  npm run setup   → recreate empty database + seed data');
console.log('  npm run build   → rebuild static UI');
