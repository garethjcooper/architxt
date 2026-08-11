import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

// Replicate the frontend parser logic for server-side unit test
function parseSectionDirectives(rawQuery) {
  if (!rawQuery || typeof rawQuery !== 'string') {
    return { intentText: '' };
  }

  const focus = {};

  const blockRe = /#(graph|table|narrative)\s*(?:\n|\r\n?)([\s\S]*?)(?:\r?\n)?#end\b/gi;
  let blockMatch;
  let blockStripped = rawQuery;
  while ((blockMatch = blockRe.exec(rawQuery)) !== null) {
    const key = blockMatch[1].toLowerCase();
    const content = blockMatch[2].trim();
    if (content) focus[key] = content;
    blockStripped = blockStripped.replace(blockMatch[0], '');
  }

  const inlineRe = /#(graph|table|narrative):\s*(.+?)(?:\r?\n|$)/gi;
  let inlineMatch;
  let inlineStripped = blockStripped;
  while ((inlineMatch = inlineRe.exec(blockStripped)) !== null) {
    const key = inlineMatch[1].toLowerCase();
    const content = inlineMatch[2].trim();
    if (content) focus[key] = content;
    inlineStripped = inlineStripped.replace(inlineMatch[0], '');
  }

  const intentText = inlineStripped.replace(/\s+/g, ' ').trim();

  return Object.keys(focus).length > 0
    ? { intentText, sectionFocus: focus }
    : { intentText };
}

describe('parseSectionDirectives', () => {
  it('returns plain text when no directives present', () => {
    const result = parseSectionDirectives('What are the CRM capabilities?');
    assert.equal(result.intentText, 'What are the CRM capabilities?');
    assert.equal(result.sectionFocus, undefined);
  });

  it('parses inline #graph directive', () => {
    const result = parseSectionDirectives('Analyze billing #graph: CRM, ERP, ICMS');
    assert.equal(result.intentText, 'Analyze billing');
    assert.deepEqual(result.sectionFocus, { graph: 'CRM, ERP, ICMS' });
  });

  it('parses inline #table directive', () => {
    const result = parseSectionDirectives('Show me #table: capabilities, dependencies');
    assert.equal(result.intentText, 'Show me');
    assert.deepEqual(result.sectionFocus, { table: 'capabilities, dependencies' });
  });

  it('parses inline #narrative directive', () => {
    const result = parseSectionDirectives('#narrative: summary\nFull system overview');
    assert.equal(result.intentText, 'Full system overview');
    assert.deepEqual(result.sectionFocus, { narrative: 'summary' });
  });

  it('parses block-style #graph directive', () => {
    const result = parseSectionDirectives('Analyze billing\n#graph\nCRM\nERP\nICMS\n#end\nfor me');
    assert.equal(result.intentText, 'Analyze billing for me');
    assert.deepEqual(result.sectionFocus, { graph: 'CRM\nERP\nICMS' });
  });

  it('parses multiple directives (mixed inline and block)', () => {
    const result = parseSectionDirectives(
      'System overview\n#graph\nCRM, ERP\n#end\n#table: capabilities\n#narrative: summary',
    );
    assert.equal(result.intentText, 'System overview');
    assert.equal(result.sectionFocus.graph, 'CRM, ERP');
    assert.equal(result.sectionFocus.table, 'capabilities');
    assert.equal(result.sectionFocus.narrative, 'summary');
  });

  it('ignores unknown directives', () => {
    const result = parseSectionDirectives('#unknown: value\nWhat is this?');
    assert.equal(result.intentText, '#unknown: value What is this?');
    assert.equal(result.sectionFocus, undefined);
  });

  it('strips whitespace from intent text', () => {
    const result = parseSectionDirectives('  Analyze   billing   #graph: CRM  ');
    assert.equal(result.intentText, 'Analyze billing');
    assert.deepEqual(result.sectionFocus, { graph: 'CRM' });
  });
});
