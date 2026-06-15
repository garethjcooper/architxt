import { Router } from 'express';
import multer from 'multer';
import { config } from '../config.js';
import { createLogger } from '../utils/logger.js';

import documentsCore from './documents-core.js';
import documentsWorkflow from './documents-workflow.js';
import documentsExtract from './documents-extract.js';
import documentTags from './document-tags.js';
import documentMetadata from './document-metadata.js';

const logger = createLogger('documents-route');
const router = Router();

// Multer for upload endpoint (used by documents-core)
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: config.storage?.max_file_size || 100 * 1024 * 1024
  }
});

/**
 * Documents Router - Composed from focused sub-routers
 * 
 * Route mounting order is CRITICAL:
 * 1. Static routes first (/extractwork, /reconcile)
 * 2. Then parameterized routes (/:id/*)
 * 
 * documents-workflow: extractwork, reconcile, claim, process, extractprogress, release
 * documents-extract: source, extracted
 * documents-core: list, get, create, delete
 */

// Mount workflow routes first (includes /extractwork, /reconcile static routes)
router.use('/', documentsWorkflow);

// Then extract routes (parameterized :id/source, :id/extracted)
router.use('/', documentsExtract);

// Document tags and metadata sub-routes (must be before documents-core's /:id)
router.use('/:id/tags', documentTags);
router.use('/:id/metadata', documentMetadata);

// Finally core routes (catch-all :id is here, so must be last)
// Note: documents-core uses upload middleware internally
router.use('/', documentsCore);

export default router;