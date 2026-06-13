#!/usr/bin/env node
/**
 * architxt Setup Script
 * =====================
 * 
 * This script prepares your environment for the first run.
 * It is idempotent — you can run it multiple times safely.
 * 
 * What it does:
 *   1. Verifies Node.js version (>= 22.0.0)
 *   2. Installs npm dependencies in server/ and ui/
 *   3. Creates required data directories (database, documents, logs, tmp)
 *   4. Copies server/.env.example to server/.env if .env is missing
 *   5. Builds the UI for first-time use
 */

import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.join(__dirname, '..');

/**
 * Print with a prefix so the user can follow along.
 */
function log(msg) {
  console.log(`[setup] ${msg}`);
}

/**
 * Check Node.js version meets minimum requirement.
 * The server requires native features from Node 22+ (ESM, fetch, etc.).
 */
function checkNodeVersion() {
  const version = process.version;        // e.g. "v22.22.2"
  const major = parseInt(version.slice(1).split('.')[0], 10);
  if (major < 22) {
    console.error(`ERROR: Node.js ${version} is too old. architxt requires Node.js >= 22.0.0.`);
    console.error(`       Install nvm and run: nvm install 22 && nvm use 22`);
    process.exit(1);
  }
  log(`Node.js ${version} is OK (>= 22.0.0)`);
}

/**
 * Run npm install in a directory. Uses --prefer-offline for speed
 * if you already have modules cached.
 */
function npmInstall(dir) {
  const fullPath = path.join(rootDir, dir);
  if (!fs.existsSync(path.join(fullPath, 'package.json'))) {
    log(`SKIP: ${dir}/ has no package.json`);
    return;
  }
  log(`Installing dependencies in ${dir}/ ...`);
  try {
    execSync('npm install', { cwd: fullPath, stdio: 'inherit' });
  } catch (err) {
    console.error(`\nERROR: npm install failed in ${dir}/`);
    process.exit(1);
  }
}

/**
 * Create a directory if it doesn't already exist.
 */
function ensureDir(dir) {
  const fullPath = path.join(rootDir, dir);
  if (!fs.existsSync(fullPath)) {
    fs.mkdirSync(fullPath, { recursive: true });
    log(`Created directory: ${dir}/`);
  } else {
    log(`Directory already exists: ${dir}/`);
  }
}

/**
 * Copy .env.example to .env if .env is missing.
 * The .env file holds local secrets and overrides — never commit it.
 */
function setupEnvFile() {
  const envExample = path.join(rootDir, 'server', '.env.example');
  const envFile = path.join(rootDir, 'server', '.env');

  if (!fs.existsSync(envFile) && fs.existsSync(envExample)) {
    fs.copyFileSync(envExample, envFile);
    log(`Created server/.env from .env.example`);
    log(`  → IMPORTANT: Edit server/.env to set your API keys before running.`);
  } else if (fs.existsSync(envFile)) {
    log(`server/.env already exists — skipping copy`);
  } else {
    log(`WARNING: server/.env.example not found — cannot create .env`);
  }
}

/**
 * Build the UI so `npm start` works immediately after setup.
 */
function buildUI() {
  log('Building UI for first-time use ...');
  try {
    execSync('npm run build', { cwd: path.join(rootDir, 'ui'), stdio: 'inherit' });
    log('UI build complete.');
  } catch (err) {
    console.error('\nERROR: UI build failed. Check the errors above.');
    process.exit(1);
  }
}

// ─── MAIN ───
console.log('');
console.log('╔══════════════════════════════════════════════════╗');
console.log('║         architxt — Environment Setup             ║');
console.log('╚══════════════════════════════════════════════════╝');
console.log('');

checkNodeVersion();
npmInstall('server');
npmInstall('ui');

ensureDir('server/database');
ensureDir('server/documents');
ensureDir('server/logs');
ensureDir('server/tmp');

setupEnvFile();
buildUI();

console.log('');
console.log('✅ Setup complete!');
console.log('');
console.log('   Next step:  npm start');
console.log('   (opens at http://localhost:3000)');
console.log('');
