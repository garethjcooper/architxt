/**
 * Persist Stage (v3 Pattern)
 * 
 * Final persistence stage - writes results to filesystem.
 * Scaffold version - simplified from archie-ai (no DB operations yet).
 */

import path from 'path';
import { promises as fs } from 'fs';
import { createLogger } from '../../utils/logger.js';

const logger = createLogger('stage-persist');

/**
 * Persist files to storage
 */
async function persistFiles(markdown, imageAnalyses, metadata, storagePath) {
  const { docId, filename } = metadata;
  
  const docDir = path.join(storagePath, String(docId));
  const convertedDir = path.join(docDir, 'converted');
  const imagesDir = path.join(docDir, 'images');
  
  try {
    await fs.mkdir(convertedDir, { recursive: true });
    await fs.mkdir(imagesDir, { recursive: true });
    
    const safeName = (filename || 'document').replace(/[^a-zA-Z0-9]/g, '_');
    const markdownPath = path.join(convertedDir, `${safeName}.md`);
    await fs.writeFile(markdownPath, markdown, 'utf8');
    
    const metadataSidecar = {
      doc_id: docId,
      filename: filename,
      created_at: new Date().toISOString(),
      image_count: imageAnalyses.length,
      converted_markdown_path: markdownPath
    };
    
    const metadataPath = path.join(convertedDir, `${safeName}.metadata.json`);
    await fs.writeFile(metadataPath, JSON.stringify(metadataSidecar, null, 2), 'utf8');
    
    for (const analysis of imageAnalyses) {
      if (analysis.description && analysis.imageId) {
        const descriptionFileName = `image-${analysis.imageId}-description.md`;
        const descriptionPath = path.join(imagesDir, descriptionFileName);
        await fs.writeFile(descriptionPath, analysis.description, 'utf8');
      }
    }
    
    logger.info('File persistence complete', {
      storageDir: docDir,
      markdownPath,
      imageCount: imageAnalyses.length
    });
    
    return {
      storageDir: docDir,
      convertedDir,
      imagesDir,
      docConvertedMarkdownPath: markdownPath,
      docMetadataSidecarPath: metadataPath,
      docArchiveImagesPath: imagesDir
    };
    
  } catch (error) {
    logger.error('File persistence failed', { error: error.message });
    throw error;
  }
}

/**
 * Execute persist stage (v3 signature)
 * 
 * @param {Object} artifacts - { markdown, imageAnalyses }
 * @param {Object} config - { storage_path }
 * @param {Object} data - { doc_id, filename }
 * @param {Object} services - {} (DB would be here)
 * @returns {Promise<Object>}
 */
async function execute(artifacts, config, data, services) {
  const startTime = Date.now();
  
  const markdown = artifacts.markdown || '';
  const imageAnalyses = artifacts.imageAnalyses || [];
  
  const metadata = {
    docId: data.doc_id,
    filename: data.filename
  };
  
  const storagePath = config.storage_path;
  
  if (!storagePath) {
    logger.error('Persist stage requires storage_path in config');
    return {
      stageResult: { success: false, error: 'No storage path configured' },
      stageMetrics: { durationMs: Date.now() - startTime },
      stageOutput: [{ name: 'archive-paths', data: null }]
    };
  }

  logger.debug('Persist stage starting', {
    markdownLength: markdown.length,
    imageAnalyses: imageAnalyses.length,
    docId: metadata.docId
  });

  try {
    // Persist files to archive storage
    const archivePaths = await persistFiles(markdown, imageAnalyses, metadata, storagePath);
    
    const durationMs = Date.now() - startTime;
    
    logger.info('Persist stage complete', {
      durationMs,
      archivePaths: archivePaths?.storageDir
    });

    return {
      stageResult: { success: true },
      stageMetrics: { durationMs },
      stageOutput: [
        { name: 'archive-paths', data: archivePaths },
        { name: 'doc-converted-markdown-path', data: archivePaths?.docConvertedMarkdownPath || null },
        { name: 'doc-metadata-sidecar-path', data: archivePaths?.docMetadataSidecarPath || null },
        { name: 'doc-archive-images-path', data: archivePaths?.docArchiveImagesPath || null }
      ]
    };
    
  } catch (error) {
    const durationMs = Date.now() - startTime;
    
    logger.error('Persist stage failed', { error: error.message, durationMs });
    
    return {
      stageResult: { success: false, error: error.message },
      stageMetrics: { durationMs },
      stageOutput: [{ name: 'archive-paths', data: null }]
    };
  }
}

function validate(config) {
  const errors = [];
  if (!config.storage_path) {
    errors.push('Missing config.storage_path');
  }
  return { valid: errors.length === 0, errors };
}

export { execute, validate };
