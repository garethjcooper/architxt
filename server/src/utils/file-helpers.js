import fs from 'node:fs/promises';
import path from 'node:path';
import { createLogger } from './logger.js';

const logger = createLogger('file-helpers');

/**
 * Ensure directory exists, create if not.
 * @param {string} dirPath
 */
export const ensureDir = async (dirPath) => {
  await fs.mkdir(dirPath, { recursive: true });
};

/**
 * Write file to storage at {basePath}/{id}/source.{ext}
 * Creates directory if needed.
 * Returns final path on success.
 * @param {Buffer} buffer
 * @param {string} basePath - root storage path
 * @param {number|string} id - document id
 * @param {string} originalFilename - to preserve extension
 * @returns {Promise<string>} - final file path
 */
export const writeToStorage = async (buffer, basePath, id, originalFilename) => {
  const destDir = path.join(basePath, String(id));
  const ext = path.extname(originalFilename);
  const destPath = path.join(destDir, `source${ext}`);

  await ensureDir(destDir);
  await fs.writeFile(destPath, buffer);

  logger.debug('File written to storage', { id, path: destPath });
  return destPath;
};

/**
 * Remove file and its containing directory.
 * Used for rollback on transaction failure.
 * Silent if already removed.
 * @param {string} filePath
 */
export const removeStorage = async (filePath) => {
  try {
    await fs.unlink(filePath);
    // Try to remove parent directory
    const dir = path.dirname(filePath);
    try {
      await fs.rmdir(dir);
    } catch (err) {
      if (err.code !== 'ENOTEMPTY') {
        throw err; // re-throw unexpected errors (permissions, etc.)
      }
      // ENOTEMPTY is fine — directory has other files
    }
    logger.debug('Removed storage file and directory', { path: filePath });
  } catch (err) {
    if (err.code !== 'ENOENT') {
      throw err; // re-throw unexpected errors
    }
    // ENOENT is fine — already gone
  }
};

/**
 * Remove entire document storage directory by id.
 * Used when deleting a document.
 * @param {string} basePath
 * @param {number|string} id
 */
export const removeStorageById = async (basePath, id) => {
  const dir = path.join(basePath, String(id));
  try {
    // Check if directory exists first
    const stats = await fs.stat(dir);
    if (!stats.isDirectory()) {
      throw new Error(`Path exists but is not a directory: ${dir}`);
    }
    
    // Remove all files in dir, then dir itself
    const files = await fs.readdir(dir);
    for (const file of files) {
      await fs.unlink(path.join(dir, file));
    }
    await fs.rmdir(dir);
    logger.debug('Removed storage directory', { id, path: dir });
  } catch (err) {
    if (err.code !== 'ENOENT') {
      throw err;
    }
    // ENOENT is fine — directory already removed
  }
};
