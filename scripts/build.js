#!/usr/bin/env node
/**
 * architxt Build Script
 * =====================
 * 
 * This script builds the Next.js UI as **static HTML**.
 * The output goes to `ui/dist/` and is served by the Express backend.
 * 
 * Why static?
 *   - No server-side rendering needed (it's a client-side React app)
 *   - Express can serve it as plain files (fast, simple)
 *   - One port, one process for end users
 */

import { execSync } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.join(__dirname, '..');

console.log('[build] Building UI for static export ...');

// Generate version.json first
execSync('node scripts/generate-version.js', {
  cwd: rootDir,
  stdio: 'inherit',
  env: process.env,
});

execSync('npm run build', {
  cwd: path.join(rootDir, 'ui'),
  stdio: 'inherit',
  env: process.env,
});

console.log('[build] Done. Output: ui/dist/');
