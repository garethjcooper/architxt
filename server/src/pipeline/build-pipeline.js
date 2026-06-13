/**
 * build-pipeline.js
 * 
 * Pattern v3: Transforms abstract pipeline definition into final, resolved definition.
 * 
 * Responsibilities:
 * 1. Resolve stage inputs against registry contracts
 * 2. Pass through stage config, data, services, optional, timeoutMs
 * 3. Validate cross-stage dependencies
 * 4. Produce static resolution map with provenance indices
 */

import { createLogger } from '../utils/logger.js';

const logger = createLogger('build-pipeline');

/**
 * Build final pipeline definition from abstract definition + registry
 * 
 * @param {Object} definition - Pipeline definition from orchestrator
 * @param {Object} registry - Stage registry
 * @returns {Object} Final pipeline with resolved inputs and full stage contracts
 */
function buildPipeline(definition, registry) {
  logger.debug('Building pipeline', { 
    name: definition.name, 
    stages: definition.stages.length 
  });

  const finalStages = [];
  const provenancePlan = [];
  
  const hasExplicitSeed = definition.stages.length > 0 && 
    (definition.stages[0].stage === 'seed' || definition.stages[0].name === 'seed');
  
  let indexOffset = 0;

  for (let i = 0; i < definition.stages.length; i++) {
    const stageRef = definition.stages[i];
    const isSeed = stageRef.stage === 'seed' || stageRef.name === 'seed';
    const stageName = isSeed ? 'seed' : (typeof stageRef === 'string' ? stageRef : stageRef.stage);
    
    let contract;
    if (isSeed) {
      contract = {
        name: 'seed',
        inputs: {},
        outputs: stageRef.outputs || [],
        execute: null,
        validate: () => ({ valid: true })
      };
    } else {
      contract = registry.get(stageName);
      if (!contract) {
        throw new Error(`Unknown stage: ${stageName}`);
      }
    }
    
    const stageIndex = isSeed ? -1 : (i - (hasExplicitSeed ? 1 : 0));
    if (isSeed) indexOffset = -1;

    const resolvedStage = resolveStageInputs({
      stageRef,
      contract,
      stageIndex,
      provenancePlan,
      isSeed,
      pipelineName: definition.name
    });

    finalStages.push(resolvedStage);

    if (!isSeed) {
      provenancePlan.push({
        index: stageIndex,
        name: stageName,
        outputs: contract.outputs || []
      });
    } else {
      provenancePlan.push({
        index: -1,
        name: 'seed',
        outputs: stageRef.outputs?.map(n => ({ name: n, type: 'any' })) || []
      });
    }
  }

  logger.info('Pipeline built', { 
    name: definition.name, 
    stages: finalStages.length,
    hasSeed: finalStages.some(s => s.index === -1)
  });

  return {
    name: definition.name,
    stages: finalStages
  };
}

function resolveStageInputs({ stageRef, contract, stageIndex, provenancePlan, isSeed, pipelineName }) {
  const stageName = isSeed ? 'seed' : (typeof stageRef === 'string' ? stageRef : stageRef.stage);
  
  if (isSeed) {
    return {
      name: 'seed',
      index: -1,
      execute: null,
      resolvedInputs: {},
      config: stageRef.config || {},
      data: stageRef.data || {},
      services: stageRef.services || {},
      optional: stageRef.optional || false,
      timeoutMs: stageRef.timeoutMs || null,
      outputs: stageRef.outputs || []
    };
  }

  const defaultInputs = contract.inputs || {};
  const overrideInputs = typeof stageRef === 'object' ? (stageRef.inputs || {}) : {};
  const inputQueries = { ...defaultInputs, ...overrideInputs };

  const resolvedInputs = {};
  
  for (const [inputName, query] of Object.entries(inputQueries)) {
    const resolution = resolveQuery(query, provenancePlan, stageIndex);
    resolvedInputs[inputName] = resolution;
  }

  return {
    name: stageName,
    execute: contract.execute,
    index: stageIndex,
    resolvedInputs,
    config: stageRef.config || {},
    data: stageRef.data || {},
    services: stageRef.services || {},
    optional: stageRef.optional || false,
    timeoutMs: stageRef.timeoutMs || null,
    outputs: contract.outputs || []
  };
}

function resolveQuery(query, provenancePlan, currentIndex) {
  if (query.source) {
    const sourceStage = provenancePlan.find(s => s.name === query.source);
    if (!sourceStage) {
      throw new Error(`Stage '${query.source}' not found before current position`);
    }
    
    const artifact = query.artifact || Object.keys(query).find(k => k !== 'source');
    if (!sourceStage.outputs.some(o => o.name === artifact)) {
      throw new Error(`Stage '${query.source}' does not produce '${artifact}'`);
    }
    
    return { fromStage: sourceStage.index, artifact };
  }

  if (query.stage !== undefined) {
    if (query.stage >= currentIndex && currentIndex !== -1) {
      throw new Error(`Cannot reference future stage ${query.stage}`);
    }
    const sourceStage = provenancePlan.find(s => s.index === query.stage);
    if (!sourceStage) {
      throw new Error(`Stage ${query.stage} not found`);
    }
    const artifact = query.artifact || Object.keys(query).find(k => k !== 'stage');
    if (!sourceStage.outputs.some(o => o.name === artifact)) {
      throw new Error(`Stage ${query.stage} does not produce '${artifact}'`);
    }
    return { fromStage: query.stage, artifact };
  }

  if (query.latest) {
    for (let i = provenancePlan.length - 1; i >= 0; i--) {
      const stage = provenancePlan[i];
      if (stage.index >= currentIndex) continue;
      if (stage.outputs.some(o => o.name === query.latest)) {
        return { fromStage: stage.index, artifact: query.latest };
      }
    }
    throw new Error(`Artifact '${query.latest}' not found in pipeline`);
  }

  if (query.any) {
    for (let i = provenancePlan.length - 1; i >= 0; i--) {
      const stage = provenancePlan[i];
      if (stage.index >= currentIndex) continue;
      if (stage.outputs.some(o => o.name === query.any)) {
        return { fromStage: stage.index, artifact: query.any };
      }
    }
    throw new Error(`Artifact '${query.any}' not found in pipeline`);
  }

  throw new Error(`Unknown query type: ${JSON.stringify(query)}`);
}

function validatePipeline(finalPipeline) {
  const errors = [];

  for (const stage of finalPipeline.stages) {
    if (stage.index === -1) continue;
    
    for (const [inputName, resolution] of Object.entries(stage.resolvedInputs)) {
      if (resolution.fromStage >= stage.index && stage.index !== -1) {
        errors.push(`'${stage.name}.${inputName}' references undefined stage ${resolution.fromStage}`);
      }
    }
  }

  return {
    valid: errors.length === 0,
    errors
  };
}

export { buildPipeline, validatePipeline };
