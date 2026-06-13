#!/usr/bin/env node
/**
 * architxt Production Start Script
 * =================================
 * 
 * This script starts architxt in **production mode**.
 * 
 * What it does:
 *   1. Generates version.json (version + git commit) for the UI
 *   2. Builds the UI (static HTML output) if not already built
 *   3. Starts the Express backend server on port 3000
 * 
 * The backend then serves:
 *   - `/api/*`      → REST API endpoints (used by the UI)
 *   - `/api-docs`   → Swagger / OpenAPI interactive documentation
 *   - `/health`     → Health check endpoint
 *   - Everything else → The built UI (single-page app)
 * 
 * The backend automatically forks two background daemons:
 *   - Extract Daemon       → Polls the database for new documents to process
 *   - Hindsight Poll Daemon→ Syncs with configured Hindsight servers
 * 
 * You only need ONE terminal and ONE port (3000).
 */

import { spawn, execSync } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.join(__dirname, '..');

/**
 * Helper: start a child process and log its output.
 */
function run(label, cmd, args, cwd) {
  console.log(`[start] ${label}: ${cmd} ${args.join(' ')}`);
  const child = spawn(cmd, args, {
    cwd,
    stdio: 'inherit',
    env: process.env,
  });

  child.on('exit', (code, signal) => {
    if (code !== 0 && signal !== 'SIGTERM' && signal !== 'SIGINT') {
      console.error(`[start] ${label} exited unexpectedly (code=${code}, signal=${signal})`);
    }
  });

  return child;
}

// ─── MAIN ───
console.log('');
console.log('╔══════════════════════════════════════════════════╗');
console.log('║      architxt — Production Start                 ║');
console.log('╠══════════════════════════════════════════════════╣');
console.log('║  Backend + UI:  http://localhost:3000            ║');
console.log('║  API Docs:     http://localhost:3000/api-docs    ║');
console.log('╚══════════════════════════════════════════════════╝');
console.log('');

// Generate version.json first (always, so UI shows current version)
execSync('node scripts/generate-version.js', {
  cwd: rootDir,
  stdio: 'inherit',
  env: process.env,
});

console.log('');

// Build the UI first (static export) if dist/ is missing
const distDir = path.join(rootDir, 'ui', 'dist');
const { existsSync } = await import('fs');

if (!existsSync(distDir)) {
  console.log('[start] UI not built yet — building now ...');
  const build = spawn('npm', ['run', 'build'], {
    cwd: path.join(rootDir, 'ui'),
    stdio: 'inherit',
    env: process.env,
    shell: true,
  });

  await new Promise((resolve) => {
    build.on('exit', (code) => {
      if (code !== 0) {
        console.error('[start] UI build failed. Aborting.');
        process.exit(1);
      }
      resolve();
    });
  });
  console.log('[start] UI build complete.');
} else {
  console.log(`[start] UI ready (static files from ${path.relative(rootDir, distDir)})`);
}

console.log('');
console.log('[start] Starting server (API + UI on same port) ...');
const backend = run('backend', 'node', ['src/index.js'], path.join(rootDir, 'server'));

// Graceful shutdown
let shuttingDown = false;
function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`\n[start] ${signal} received — shutting down ...`);
  backend.kill(signal);
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
