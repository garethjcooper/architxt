#!/usr/bin/env node
/**
 * architxt Purge Script
 * ======================
 *
 * Full reset — deletes ALL generated files, returning the repo to a
 * clean checkout state (minus the actual git history).
 *
 * What it removes:
 *   - database/      → SQLite DB and WAL files
 *   - documents/     → Uploaded files and conversions
 *   - logs/          → Application logs
 *   - tmp/           → Temporary processing files
 *   - ui/dist/       → Built static UI artifacts
 *   - ui/.next/      → Next.js build cache
 *   - node_modules/  → Installed dependencies (both root, server/, ui/)
 *   - package-lock.json files
 *
 * Prompts before removing:
 *   - server/.env    → Only if present
 *
 * After running:
 *   npm run setup   → reinstall deps + recreate empty DB + seed data
 */

import fs from 'fs';
import path from 'path';
import { createInterface } from 'readline';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.join(__dirname, '..');

function log(msg) {
  console.log(`[purge] ${msg}`);
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

function rmFile(file) {
  const fullPath = path.join(rootDir, file);
  if (fs.existsSync(fullPath)) {
    fs.unlinkSync(fullPath);
    log(`Removed: ${file}`);
  } else {
    log(`Already gone: ${file}`);
  }
}

async function prompt(question) {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer.trim().toLowerCase());
    });
  });
}

console.log('');
console.log('╔══════════════════════════════════════════════════╗');
console.log('║      architxt — PURGE (Full Reset)              ║');
console.log('╠══════════════════════════════════════════════════╣');
console.log('║  Removes: database/, documents/, logs/, tmp/      ║');
console.log('║           ui/dist/, ui/.next/, node_modules/      ║');
console.log('║           package-lock.json files                 ║');
console.log('║  Prompts: .env deletion                           ║');
console.log('╚══════════════════════════════════════════════════╝');
console.log('');

// Remove data directories unconditionally
const dataTargets = ['database', 'documents', 'logs', 'tmp', path.join('ui', 'dist'), path.join('ui', '.next')];
for (const target of dataTargets) {
  rmDir(target);
}

// Prompt before removing .env
const envPath = path.join(rootDir, 'server', '.env');
if (fs.existsSync(envPath)) {
  const answer = await prompt('[purge] Delete server/.env? (y/N): ');
  if (answer === 'y' || answer === 'yes') {
    rmFile(path.join('server', '.env'));
  } else {
    log('Kept: server/.env');
  }
}

// Remove node_modules and lockfiles
const moduleTargets = ['node_modules', path.join('server', 'node_modules'), path.join('ui', 'node_modules')];
for (const target of moduleTargets) {
  rmDir(target);
}

const lockfiles = ['package-lock.json', path.join('server', 'package-lock.json'), path.join('ui', 'package-lock.json')];
for (const lockfile of lockfiles) {
  rmFile(lockfile);
}

log('Done.');
console.log('');
console.log('Next step:');
console.log('  npm run setup   → reinstall everything + empty DB + seed data');
