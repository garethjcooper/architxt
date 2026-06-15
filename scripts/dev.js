#!/usr/bin/env node
/**
 * architxt Development Start Script
 * ==================================
 * 
 * This script starts architxt in **development mode**.
 * 
 * What it does:
 *   - Starts the Express backend on port 3000
 *   - Starts the Next.js dev server on port 3001 (with hot reload)
 * 
 * In development, the UI dev server proxies API calls to the backend.
 * Open the UI at:  http://localhost:3001
 * The API is at:   http://localhost:3000/api/v1/
 */

import { spawn, execSync } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.join(__dirname, '..');

const processes = [];

/**
 * Start a named child process and track it for cleanup.
 */
function run(label, cmd, args, cwd) {
  console.log(`[dev] Starting ${label}: ${cmd} ${args.join(' ')}`);
  const child = spawn(cmd, args, {
    cwd,
    stdio: 'inherit',
    env: { ...process.env, ARCHITXT_UI_API_BASE_URL: 'http://localhost:3000' },
  });

  child.label = label;
  processes.push(child);

  child.on('exit', (code, signal) => {
    console.log(`[dev] ${label} exited (code=${code}, signal=${signal})`);
  });

  return child;
}

// ─── MAIN ───
console.log('');
console.log('╔══════════════════════════════════════════════════╗');
console.log('║      architxt — Development Mode                 ║');
console.log('╚══════════════════════════════════════════════════╝');
console.log('');

// Generate version.json for dev mode UI
execSync('node scripts/generate-version.js', {
  cwd: rootDir,
  stdio: 'inherit',
  env: process.env,
});

console.log('');
console.log('╔══════════════════════════════════════════════════╗');
console.log('║      architxt — Development Mode                 ║');
console.log('╠══════════════════════════════════════════════════╣');
console.log('║  Backend API:  http://localhost:3000             ║');
console.log('║  API Docs:     http://localhost:3000/api-docs    ║');
console.log('║  UI Dev:       http://localhost:3001             ║');
console.log('║                                                  ║');
console.log('║  Press Ctrl+C to stop both services.             ║');
console.log('╚══════════════════════════════════════════════════╝');
console.log('');

// Start backend
run('backend', 'node', ['src/index.js'], path.join(rootDir, 'server'));
console.log('');

// Start Next.js dev server (with hot reload)
run('ui', 'npx', ['next', 'dev'], path.join(rootDir, 'ui'));

// Graceful shutdown
let shuttingDown = false;
function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`\n[dev] ${signal} received — stopping all services ...`);

  for (const child of processes) {
    console.log(`[dev] Killing ${child.label} (pid=${child.pid}) ...`);
    child.kill(signal);
  }

  // Force exit after 5 seconds if something is stuck
  setTimeout(() => {
    console.log('[dev] Forcing exit.');
    process.exit(1);
  }, 5000);
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
