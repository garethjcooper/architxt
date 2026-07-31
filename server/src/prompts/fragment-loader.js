import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const FRAGMENTS_DIR = path.join(path.dirname(__filename), 'fragments');

/**
 * Load a single fragment by name.
 * @param {string} name - Fragment file name, with or without `.md` extension.
 * @returns {string} Fragment content.
 * @throws {Error} If the fragment file does not exist.
 */
export function loadFragment(name) {
  const base = name.endsWith('.md') ? name : `${name}.md`;
  const filePath = path.join(FRAGMENTS_DIR, base);
  if (!fs.existsSync(filePath)) {
    throw new Error(`Prompt fragment not found: ${base}`);
  }
  return fs.readFileSync(filePath, 'utf-8');
}

/**
 * Compose multiple fragments in order, separated by a blank line.
 * @param {string[]} names - Fragment names.
 * @returns {string} Composed fragment text.
 */
export function composeFragments(names) {
  if (!Array.isArray(names) || names.length === 0) return '';
  return names.map((name) => loadFragment(name)).join('\n\n');
}
