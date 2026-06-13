#!/usr/bin/env node
/**
 * Generate version.json for the UI
 * ================================
 * 
 * Reads package.json version and latest git commit hash,
 * writes a version.json that the UI can display at runtime.
 * 
 * Used by: scripts/build.js, scripts/dev.js
 */

import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.join(__dirname, '..');

// Read version from root package.json
const pkg = JSON.parse(fs.readFileSync(path.join(rootDir, 'package.json'), 'utf-8'));

// Get short commit hash from git
let commit = 'unknown';
try {
  commit = execSync('git rev-parse --short HEAD', { cwd: rootDir, encoding: 'utf-8' }).trim();
} catch {
  // git not available — leave as 'unknown'
}

const versionInfo = {
  version: pkg.version || '0.0.0',
  commit,
};

// Write to ui/public so Next.js serves it as a static asset
const publicDir = path.join(rootDir, 'ui', 'public');
if (!fs.existsSync(publicDir)) {
  fs.mkdirSync(publicDir, { recursive: true });
}

const outputPath = path.join(publicDir, 'version.json');
fs.writeFileSync(outputPath, JSON.stringify(versionInfo, null, 2));

// Also copy to ui/dist/ if it exists (so already-built apps get updated)
const distPath = path.join(rootDir, 'ui', 'dist', 'version.json');
if (fs.existsSync(path.dirname(distPath))) {
  fs.writeFileSync(distPath, JSON.stringify(versionInfo, null, 2));
  console.log(`[version] v${versionInfo.version} (commit: ${versionInfo.commit}) → ${outputPath} + dist/`);
} else {
  console.log(`[version] v${versionInfo.version} (commit: ${versionInfo.commit}) → ${outputPath}`);
}
