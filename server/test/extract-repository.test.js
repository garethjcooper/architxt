/**
 * Tests for the extract-repository pipeline stage and daemon routing.
 * The gitdiagram-serve HTTP client is stubbed via a local HTTP server.
 */

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';

// Point the client at a stub server before importing modules that read config.
let stubServer;
let stubPort;
let lastRequest = null;
let stubResponse = {
  ok: true,
  repo: { path: '/repos/demo', head: 'abc123', branch: 'main' },
  explanation: { text: 'A demo repo.' },
  graph: { nodes: [{ id: 'a', label: 'A' }], edges: [] },
  mermaid: 'graph TD\n  n_a["A"]',
  usage: { promptTokens: 10, completionTokens: 20 },
};

before(async () => {
  stubServer = http.createServer((req, res) => {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      if (req.url === '/healthz') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ status: 'ok' }));
        return;
      }
      lastRequest = { url: req.url, method: req.method, body: JSON.parse(body || '{}') };
      if (lastRequest.body.repo === '/fail') {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: 'not a git repo' }));
        return;
      }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(stubResponse));
    });
  });
  await new Promise((resolve) => stubServer.listen(0, '127.0.0.1', resolve));
  stubPort = stubServer.address().port;
  process.env.GITDIAGRAM_SERVICE_URL = `http://127.0.0.1:${stubPort}`;
});

after(() => stubServer?.close());

test('analyzeRepository posts repo URI and returns parsed result', async () => {
  const { analyzeRepository } = await import('../src/services/gitdiagram/client.js');
  const result = await analyzeRepository('https://github.com/example/demo', { maxSourceFiles: 5 });
  assert.equal(lastRequest.url, '/v1/analyze');
  assert.deepEqual(lastRequest.body, { repo: 'https://github.com/example/demo', options: { maxSourceFiles: 5 } });
  assert.equal(result.mermaid, stubResponse.mermaid);
  assert.equal(result.explanation, 'A demo repo.');
  assert.equal(result.repo.head, 'abc123');
});

test('analyzeRepository surfaces service errors', async () => {
  const { analyzeRepository } = await import('../src/services/gitdiagram/client.js');
  await assert.rejects(() => analyzeRepository('/fail'), /not a git repo/);
});

test('extract-repository stage emits document-md as markdown with fenced mermaid + json graph', async () => {
  const stage = await import('../src/pipeline/stages/extract-repository.js');
  const out = await stage.execute(
    {},
    { gitdiagram: { serviceUrl: `http://127.0.0.1:${stubPort}` } },
    { doc_id: 1, source_path: 'https://github.com/example/demo', doc_processing_options: { repo_uri: 'https://github.com/example/demo' } },
    {},
    {},
  );
  assert.equal(out.stageResult.success, true);
  const md = out.stageOutput.find((o) => o.name === 'document-md');
  // Plain markdown, not a JSON envelope
  assert.match(md.data, /A demo repo\./);
  assert.doesNotMatch(md.data.trim(), /^\{/);
  // Mermaid in a fenced mermaid block
  assert.match(md.data, /```mermaid\n[\s\S]*graph TD[\s\S]*```/);
  // Graph in a fenced json block
  const jsonBlock = md.data.match(/```json\n([\s\S]*?)```/);
  assert.ok(jsonBlock, 'missing fenced json block');
  const graph = JSON.parse(jsonBlock[1]);
  assert.deepEqual(graph, stubResponse.graph);
  assert.ok(!out.stageOutput.find((o) => o.name === 'document-envelope'), 'no separate envelope artifact');
  const images = out.stageOutput.find((o) => o.name === 'document-images');
  assert.deepEqual(images.data, []);
});

test('extract-repository stage fails cleanly without repo_uri', async () => {
  const stage = await import('../src/pipeline/stages/extract-repository.js');
  const out = await stage.execute(
    {},
    { gitdiagram: { serviceUrl: `http://127.0.0.1:${stubPort}` } },
    { doc_id: 2, source_path: 'UPLOADING', doc_processing_options: {} },
    {},
    {},
  );
  assert.equal(out.stageResult.success, false);
  assert.match(out.stageResult.error, /repo_uri/);
});

test('daemon routes repository docs to the extract-repository pipeline definition', async () => {
  const { getExtractRepositoryPipelineDefinition, getExtractTracePipelineDefinition, getExtractPipelineDefinition } = await import('../src/daemons/extract/pipeline-runner.js');

  const repoDef = getExtractRepositoryPipelineDefinition({});
  assert.equal(repoDef.name, 'extract-repository');
  assert.equal(repoDef.stages[0].stage, 'extract-repository');
  assert.ok(repoDef.stages[0].config.gitdiagram, 'stage config carries gitdiagram service config');

  // Sanity: the other two types still route to their own pipelines
  assert.equal(getExtractTracePipelineDefinition({}).name, 'extract-trace');
  assert.equal(getExtractPipelineDefinition({}).name, 'extract-basic');
});

test('schema migration widens doc_source_type CHECK to include repository', async () => {
  const { ensureSchema } = await import('../src/db/ensure-schema.js');
  const Database = (await import('better-sqlite3')).default;
  const os = await import('node:os');
  const path = await import('node:path');
  const fs = await import('node:fs');
  const tmp = path.join(await fs.promises.mkdtemp(path.join(os.tmpdir(), 'gds-schema-')), 't.db');
  const db = new Database(tmp);
  ensureSchema(db);
  const sql = db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='documents'").pluck().get();
  assert.match(sql, /'repository'/);
  // Insert a repository doc to prove the CHECK accepts it
  db.prepare("INSERT INTO documents (doc_ext_id, doc_status, doc_source_type) VALUES ('r1', 'uploaded', 'repository')").run();
  const row = db.prepare("SELECT doc_source_type FROM documents WHERE doc_ext_id = 'r1'").get();
  assert.equal(row.doc_source_type, 'repository');
  db.close();
});

test('buildMarkdown renders explanation + mermaid + fenced json graph', async () => {
  const { buildMarkdown } = await import('../src/pipeline/stages/extract-repository.js');
  const result = {
    repo: { path: '/repos/architxt-abc', remoteUri: 'https://example/repo.git' },
    explanation: 'The API server routes documents.',
    graph: {
      nodes: [
        { id: 'api', label: 'API Server', path: 'server/src/index.js' },
        { id: 'ext', label: 'LLM' },
      ],
      edges: [{ from: 'api', to: 'ext', label: 'calls', dashed: false }],
    },
    mermaid: 'graph TD\n  api-->ext',
  };
  const md = buildMarkdown(result);
  assert.match(md, /The API server routes documents\./);
  assert.match(md, /```mermaid\n[\s\S]*api-->ext[\s\S]*```/);
  const jsonBlock = md.match(/```json\n([\s\S]*?)```/);
  assert.ok(jsonBlock, 'missing fenced json block');
  const parsed = JSON.parse(jsonBlock[1]);
  // Standard vocabulary labels are promoted to `type` (architxt edge shape)
  assert.deepEqual(parsed.edges, [{ from: 'api', to: 'ext', type: 'calls', label: '', dashed: false }]);
  // Non-standard / free-form labels pass through untouched
  const free = buildMarkdown({ ...result, graph: { nodes: result.graph.nodes, edges: [{ from: 'api', to: 'ext', label: 'publishes events to' }] } });
  assert.deepEqual(JSON.parse(free.match(/```json\n([\s\S]*?)```/)[1]).edges, [{ from: 'api', to: 'ext', label: 'publishes events to' }]);
  // Explanation object form also works
  assert.match(buildMarkdown({ ...result, explanation: { text: 'Obj form.' } }), /Obj form\./);
});
