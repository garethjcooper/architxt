/**
 * Pipeline Module (architxt)
 * 
 * Core pipeline architecture brought from archie-ai.
 * Simplified for document extraction workflows.
 * 
 * Pattern: registry.js defines registerDefaults(), index.js calls it + exports
 */

import { createRunner } from './runner.js';
import { buildPipeline, validatePipeline } from './build-pipeline.js';
import { StageRegistry, registry, getRegisteredStages } from './registry.js';

// Register all default stages (called once at module load)
await registry.registerDefaults();

export {
  // Core functions
  createRunner,
  buildPipeline,
  validatePipeline,
  
  // Registry
  StageRegistry,
  registry,
  getRegisteredStages
};
