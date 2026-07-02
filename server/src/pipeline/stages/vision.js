/**
 * Vision Stage (v3 Pattern)
 * 
 * Image analysis stage - describes images using vision-capable LLM.
 * Now uses the LLM stage service for actual vision calls.
 */

import { createLogger } from '../../utils/logger.js';
import { describeImage } from '../../services/llm/stage-service.js';

const logger = createLogger('stage-vision');

/**
 * Process images with limited concurrency
 */
async function processWithConcurrency(images, processFn, concurrency = 3, signal) {
  const results = new Array(images.length);

  for (let i = 0; i < images.length; i += concurrency) {
    // Check for cancellation before each batch
    if (signal?.aborted) {
      throw new Error('Vision cancelled by abort signal');
    }

    const batch = images.slice(i, i + concurrency);
    const batchPromises = batch.map((image, batchIndex) => {
      const globalIndex = i + batchIndex;
      return processFn(image, globalIndex).then(result => {
        results[globalIndex] = result;
      });
    });
    await Promise.all(batchPromises);
  }

  return results;
}

/**
 * Execute vision stage (v3 signature)
 * 
 * @param {Object} artifacts - { images: Array, markdown: string }
 * @param {Object} config - { diagram_description: {...} }
 * @param {Object} data - { doc_id }
 * @param {Object} services - {} (service imported directly)
 * @returns {Promise<{stageResult, stageMetrics, stageOutput}>}
 */
async function execute(artifacts, config, data, services, context) {
  const startTime = Date.now();

  const images = artifacts.images;
  let markdown = artifacts.markdown;
  const docId = data.doc_id;

  logger.debug('Vision stage received artifacts', {
    docId,
    hasImages: !!images,
    imageCount: images?.length,
    markdownLength: markdown?.length
  });

  if (!images || !Array.isArray(images) || images.length === 0) {
    logger.debug('No images to analyze');
    return {
      stageResult: { success: true },
      stageMetrics: { durationMs: 0 },
      stageOutput: [
        { name: 'image-analyses', data: [] },
        { name: 'document-md', data: markdown }
      ]
    };
  }

  // Images have .data (base64 string), convert to Buffer for LLM
  // Preserve original image id, filename, page_num, etc.
  const imagesWithBuffers = images
    .filter(img => img?.data && typeof img.data === 'string')
    .map(img => ({
      ...img,
      buffer: Buffer.from(img.data, 'base64')
    }));

  logger.debug('Vision stage: image ID mapping', {
    originalImageIds: images.map(img => img.id),
    filteredImageIds: imagesWithBuffers.map(img => img.id)
  });

  if (imagesWithBuffers.length === 0) {
    logger.warn('No images with valid data found', {
      totalImages: images.length,
      withData: images.filter(img => img?.data).length
    });
    return {
      stageResult: { success: true },
      stageMetrics: { durationMs: Date.now() - startTime },
      stageOutput: [
        { name: 'image-analyses', data: [] },
        { name: 'document-md', data: markdown }
      ]
    };
  }

  const visionConfig = config.diagram_description;
  const concurrency = visionConfig?.concurrency || 3;

  logger.info('Vision: Starting image analysis', {
    imageCount: imagesWithBuffers.length,
    concurrency
  });

  // Process images through LLM vision service
  const analyses = await processWithConcurrency(
    imagesWithBuffers,
    async (img, index) => {
      const imageStartTime = Date.now();

      // Emit image progress
      if (context?.emit) {
        context.emit('progress', {
          current: index + 1,
          total: imagesWithBuffers.length,
          label: `image ${index + 1}/${imagesWithBuffers.length}`
        });
      }

      // Use the original image ID from extract stage, not the array index
      const originalImageId = img.id || `image-${index}`;

      logger.debug(`Vision: Analyzing image ${index + 1}/${imagesWithBuffers.length}`, {
        originalImageId,
        page: img.page_num,
        filename: img.filename
      });

      // Call LLM vision service with the image buffer
      logger.debug('Calling describeImage for image', {
        docId,
        imageIndex: index,
        originalImageId,
        hasBuffer: !!img.buffer,
        bufferLength: img.buffer?.length
      });

      const result = await describeImage(img.buffer, visionConfig);

      const imageDurationMs = Date.now() - imageStartTime;

      // Emit image completion
      if (context?.emit) {
        context.emit('progress', {
          event: 'item_complete',
          current: index + 1,
          total: imagesWithBuffers.length,
          label: `image ${index + 1}/${imagesWithBuffers.length}`,
          durationMs: imageDurationMs,
          success: result.success
        });
      }

      if (!result.success) {
        logger.error(`Vision: Failed for image ${index + 1}`, {
          originalImageId,
          error: result.error,
          code: result.code
        });

        return {
          imageId: originalImageId,  // Use original ID for placeholder matching
          imageFilename: img.filename || `${originalImageId}.png`,
          description: `Image analysis failed: ${result.error}`,
          section: 'images',
          heading: '',
          savedPath: img.saved_path,
          proposedSubKind: '',
          confidence: 0.0,
          guid: `guid-${originalImageId}`,
          tokens: 0,
          durationMs: imageDurationMs,
          page_num: img.page_num,
          error: result.error
        };
      }

      return {
        imageId: originalImageId,  // Use original ID for placeholder matching
        imageFilename: img.filename || `${originalImageId}.png`,
        description: result.data,
        section: 'images',
        heading: '',
        savedPath: img.saved_path,
        proposedSubKind: '',
        confidence: 0.95,
        guid: `guid-${originalImageId}`,
        tokens: result.data?.length || 0,
        durationMs: imageDurationMs,
        page_num: img.page_num
      };
    },
    concurrency,
    context?.abortSignal
  );

  const durationMs = Date.now() - startTime;

  // Replace IMAGE placeholders in markdown
  for (const analysis of analyses) {
    if (!analysis.guid || !analysis.imageId) continue;

    const placeholderPatterns = [
      `{{IMAGE:pending:${analysis.imageId}}}`
    ];

    const description = analysis.description || '';
    const replacementTag = description
      ? `[IMAGE:${analysis.imageId}]\n${description}\n[/IMAGE:${analysis.imageId}]`
      : '';

    for (const pattern of placeholderPatterns) {
      const escapedPattern = pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      // Use callback to avoid special $ interpretation in replacement string
      markdown = markdown.replace(new RegExp(escapedPattern, 'g'), () => replacementTag);
    }
  }

  const failedAnalyses = analyses.filter(a => a.error);
  const successCount = analyses.length - failedAnalyses.length;
  const failCount = failedAnalyses.length;

  // Build a concise top-level error message when images fail
  let stageError;
  if (failCount > 0) {
    const errorMessages = failedAnalyses
      .map(a => a.error)
      .filter((value, index, self) => self.indexOf(value) === index);
    stageError = failCount === 1
      ? `Vision failed for 1 image: ${errorMessages[0]}`
      : `Vision failed for ${failCount}/${analyses.length} images: ${errorMessages.join('; ')}`;
  }

  logger.info('Vision: Image analysis complete', {
    total: analyses.length,
    success: successCount,
    failed: failCount,
    durationMs,
    markdownLength: markdown.length
  });

  return {
    stageResult: { success: failCount === 0, error: stageError },
    stageMetrics: {
      durationMs,
      totalImages: analyses.length,
      successCount,
      failCount,
      failedImageIds: failedAnalyses.map(a => a.imageId)
    },
    stageOutput: [
      { name: 'image-analyses', data: analyses },
      { name: 'document-md', data: markdown }
    ]
  };
}

function validate(config) {
  const errors = [];

  // Validate that diagram_description config exists
  if (!config.diagram_description) {
    errors.push('Missing diagram_description config');
  } else {
    if (!config.diagram_description.task_prompt) {
      errors.push('Missing diagram_description.task_prompt');
    }
    if (!config.diagram_description.system_prompt) {
      errors.push('Missing diagram_description.system_prompt');
    }
  }

  return { valid: errors.length === 0, errors };
}

export { execute, validate };
