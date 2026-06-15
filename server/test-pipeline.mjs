import { buildPipeline, createRunner, registry } from './src/pipeline/index.js';

console.log('Modules loaded successfully');

const testReporter = {
  onPipelineStart: (p, ctx) => console.log('Pipeline start:', p.name, 'stages:', ctx.stages),
  onStageStart: (s) => console.log('  Stage start:', s.name),
  onStageComplete: (s, { result }) => console.log('  Stage complete:', s.name, 'success:', result.success),
  onPipelineComplete: (r) => console.log('Pipeline complete:', r.success)
};

const runner = createRunner({ reporter: testReporter });
const pipeline = buildPipeline(['extract', 'denoise']);
console.log('Pipeline built:', pipeline.name, 'stages:', pipeline.stages.length);

runner.execute(pipeline, { 'source-path': '/tmp/test.pdf' }, {
  config: { storage_path: '/tmp/storage' },
  data: { doc_id: 123, filename: 'test.pdf', source_path: '/tmp/test.pdf' },
  services: {}
}).then(result => {
  console.log('Final result success:', result.success);
  console.log('Results per stage:', result.results.map(r => ({ stage: r.stage, success: r.success })));
  process.exit(0);
}).catch(err => {
  console.error('Error:', err.message);
  console.error(err.stack);
  process.exit(1);
});
