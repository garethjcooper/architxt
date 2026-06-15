/**
 * Stage Registry
 * Central registration for all pipeline stages
 * 
 * Pattern: registry.js contains stage definitions, index.js exports
 * Following archie-ai v3 pipeline architecture
 */

import { createLogger } from '../utils/logger.js';

const logger = createLogger('pipeline-registry');

// Stage implementations - dynamically imported for ESM
let stageModules = null;

async function getStageModules() {
  if (!stageModules) {
    const [extract, denoise, denoiseLLM, vision, persist] = await Promise.all([
      import('./stages/extract.js'),
      import('./stages/denoise.js'),
      import('./stages/denoise-llm.js'),
      import('./stages/vision.js'),
      import('./stages/persist.js')
    ]);
    stageModules = { extract, denoise, denoiseLLM, vision, persist };
  }
  return stageModules;
}

class StageRegistry {
  constructor() {
    this.stages = new Map();
  }

  /**
   * Register a stage
   * @param {string} name - Stage name
   * @param {Object} stage - Stage definition
   */
  register(name, stage) {
    if (this.stages.has(name)) {
      logger.warn('Overwriting existing stage', { name });
    }
    this.stages.set(name, stage);
    logger.debug('Stage registered', { name, type: stage.type });
  }

  /**
   * Get a registered stage
   * @param {string} name - Stage name
   * @returns {Object|undefined} Stage definition
   */
  get(name) {
    return this.stages.get(name);
  }

  /**
   * Check if stage exists
   * @param {string} name - Stage name
   * @returns {boolean}
   */
  has(name) {
    return this.stages.has(name);
  }

  /**
   * Get all registered stages
   * @returns {Object} Map of name -> stage
   */
  getAll() {
    return Object.fromEntries(this.stages);
  }

  /**
   * Register default/built-in stages
   * Called once during module initialization
   */
  async registerDefaults() {
    const modules = await getStageModules();

    // Extract stage (I/O)
    this.register('extract', {
      name: 'extract',
      type: 'io',
      execute: modules.extract.execute,
      validate: modules.extract.validate,
      inputs: {},
      outputs: [
        { name: 'document-md', type: 'string' },
        { name: 'document-images', type: 'array' }
      ],
      inputSchema: [],
      configSchema: ['storage_path'],
      dataSchema: ['doc_id', 'source_path', 'filename'],
      serviceSchema: ['extractor']
    });

    // Denoise stage (text transform)
    this.register('denoise', {
      name: 'denoise',
      type: 'transform',
      execute: modules.denoise.execute,
      validate: modules.denoise.validate,
      inputs: { markdown: { latest: 'document-md' } },
      outputs: [{ name: 'document-md', type: 'string' }],
      inputSchema: [],
      configSchema: ['document_denoise'],
      dataSchema: ['doc_id'],
      serviceSchema: []
    });

    // Denoise LLM stage
    this.register('denoise-llm', {
      name: 'denoise-llm',
      type: 'llm',
      execute: modules.denoiseLLM.execute,
      validate: modules.denoiseLLM.validate,
      inputs: { markdown: { latest: 'document-md' } },
      outputs: [{ name: 'document-md', type: 'string' }],
      inputSchema: [],
      configSchema: ['document_denoise_llm'],
      dataSchema: ['doc_id'],
      serviceSchema: []
    });

    // Vision stage
    this.register('vision', {
      name: 'vision',
      type: 'llm',
      execute: modules.vision.execute,
      validate: modules.vision.validate,
      inputs: { 
        images: { latest: 'document-images' },
        markdown: { latest: 'document-md' }
      },
      outputs: [
        { name: 'image-analyses', type: 'array' },
        { name: 'document-md', type: 'string' }
      ],
      inputSchema: [],
      configSchema: ['diagram_description'],
      dataSchema: ['doc_id'],
      serviceSchema: []
    });

    // Persist stage
    this.register('persist', {
      name: 'persist',
      type: 'io',
      execute: modules.persist.execute,
      validate: modules.persist.validate,
      inputs: {
        markdown: { latest: 'document-md' },
        imageAnalyses: { latest: 'image-analyses' }
      },
      outputs: [
        { name: 'archive-paths', type: 'object' },
        { name: 'doc-converted-markdown-path', type: 'string' }
      ],
      inputSchema: [],
      configSchema: ['storage_path'],
      dataSchema: ['doc_id', 'filename'],
      serviceSchema: []
    });

    logger.info('Default pipeline stages registered', { count: this.stages.size });
  }
}

// Singleton instance
const registry = new StageRegistry();

function getRegisteredStages() {
  return registry.getAll();
}

export { 
  StageRegistry, 
  registry, 
  getRegisteredStages 
};
