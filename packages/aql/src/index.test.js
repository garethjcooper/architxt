import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  parseAql,
  parseReferences,
  parseEntityReferences,
  parseEdgeReferences,
  stripReferences,
  renderAqlTokens,
  MERMAID_DIAGRAM_TYPES,
} from './index.js';

describe('parseAql', () => {
  it('parses a plain query with implicit intent text', () => {
    const q = parseAql('What is the impact of ICMS on Billing?');
    assert.equal(q.intentText, 'What is the impact of ICMS on Billing?');
    assert.deepEqual(q.blocks, []);
    assert.equal(q.errors, undefined);
  });

  it('parses a graph block', () => {
    const q = parseAql('#graph\nCRM, Billing\n#end');
    assert.equal(q.intentText, 'CRM, Billing');
    assert.equal(q.blocks.length, 1);
    assert.equal(q.blocks[0].kind, 'graph');
    assert.equal(q.blocks[0].body, 'CRM, Billing');
    assert.equal(q.errors, undefined);
  });

  it('parses a table block with name', () => {
    const q = parseAql('#table\n#name Dependencies\nlist upstream relationships\n#end');
    assert.equal(q.blocks.length, 1);
    assert.equal(q.blocks[0].kind, 'table');
    assert.equal(q.blocks[0].name, 'Dependencies');
    assert.equal(q.blocks[0].body, 'list upstream relationships');
    assert.equal(q.intentText, 'Dependencies');
  });

  it('parses a diagram block with quoted name and type', () => {
    const q = parseAql('#diagram\n#name "Entity lifecycle"\n#type sequenceDiagram\nAlice->>Bob: Hello\n#end');
    assert.equal(q.blocks.length, 1);
    assert.equal(q.blocks[0].kind, 'diagram');
    assert.equal(q.blocks[0].name, 'Entity lifecycle');
    assert.equal(q.blocks[0].type, 'sequenceDiagram');
    assert.equal(q.blocks[0].body, 'Alice->>Bob: Hello');
    assert.equal(q.intentText, 'Entity lifecycle (sequenceDiagram)');
  });

  it('returns errors for unclosed blocks', () => {
    const q = parseAql('#graph\nCRM');
    assert.ok(q.errors);
    assert.ok(q.errors.some((e) => /Unclosed/.test(e.message)));
  });

  it('returns errors for unknown directives', () => {
    const q = parseAql('#graph\n#foo bar\n#end');
    assert.ok(q.errors);
    assert.ok(q.errors.some((e) => /Unknown directive/.test(e.message)));
  });

  it('returns errors for disallowed sub-directive keys', () => {
    const q = parseAql('#table\n#type flowchart\n#name T\n#end');
    assert.ok(q.errors);
    assert.ok(q.errors.some((e) => /not allowed/.test(e.message)));
  });

  it('returns errors for unmatched #end', () => {
    const q = parseAql('#end');
    assert.ok(q.errors);
    assert.ok(q.errors.some((e) => /No opening directive/.test(e.message)));
  });

  it('returns errors for unknown diagram type', () => {
    const q = parseAql('#diagram\n#type notARealDiagram\n#end');
    assert.ok(q.errors);
    assert.ok(q.errors.some((e) => /Unknown diagram type/.test(e.message)));
  });

  it('allows quoted empty name', () => {
    const q = parseAql('#table\n#name ""\ncontent\n#end');
    assert.equal(q.blocks[0].name, '');
    assert.equal(q.errors, undefined);
  });

  it('keeps intent text outside blocks', () => {
    const q = parseAql('compare current and desired state\n#graph\nCRM\n#end');
    assert.equal(q.intentText, 'compare current and desired state');
  });
});

describe('parseReferences', () => {
  it('finds entity references', () => {
    const refs = parseEntityReferences('[[ICMS (Company:COM-002)]] and [[Billing]]');
    assert.equal(refs.length, 2);
    assert.equal(refs[0].kind, 'entity');
    assert.equal(refs[0].label, 'ICMS');
    assert.equal(refs[0].type, 'Company');
    assert.equal(refs[0].id, 'COM-002');
    assert.equal(refs[1].kind, 'entity');
    assert.equal(refs[1].id, 'Billing');
    assert.equal(refs[1].type, null);
  });

  it('finds edge references', () => {
    const refs = parseEdgeReferences('[[ICMS — depends-on → Billing]]');
    assert.equal(refs.length, 1);
    assert.equal(refs[0].kind, 'edge');
    assert.equal(refs[0].from, 'ICMS');
    assert.equal(refs[0].edgeLabel, 'depends-on');
    assert.equal(refs[0].to, 'Billing');
  });

  it('strips reference markup', () => {
    assert.equal(stripReferences('[[ICMS (Company:COM-002)]]'), 'ICMS');
    assert.equal(stripReferences('[[ICMS — depends-on → Billing]]'), 'ICMS — depends-on → Billing');
  });
});

describe('renderAqlTokens', () => {
  it('emits directive tokens', () => {
    const tokens = renderAqlTokens('#diagram\n#name Foo\n#end');
    const directives = tokens.filter((t) => t.kind === 'directive');
    assert.equal(directives.length, 3);
    assert.equal(directives[0].keyword, 'diagram');
    assert.equal(directives[1].keyword, 'name');
    assert.equal(directives[1].value, 'Foo');
    assert.equal(directives[2].keyword, 'end');
  });
});

describe('MERMAID_DIAGRAM_TYPES', () => {
  it('contains expected diagram types', () => {
    assert.ok(MERMAID_DIAGRAM_TYPES.has('sequenceDiagram'));
    assert.ok(MERMAID_DIAGRAM_TYPES.has('flowchart'));
    assert.ok(!MERMAID_DIAGRAM_TYPES.has('notARealDiagram'));
  });
});
