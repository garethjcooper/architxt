import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

// Replicate the frontend parser + config for server-side unit test
const SECTION_DIRECTIVE_CONFIG = {
  graph:     { cardinality: 'single', merge: 'concat' },
  table:     { cardinality: 'multiple' },
  narrative: { cardinality: 'single', merge: 'concat' },
};

function parseSectionDirectives(rawQuery) {
  if (!rawQuery || typeof rawQuery !== 'string') {
    return { intentText: '' };
  }

  const focus = {};

  // Block style ONLY: #directive\n...content...\n#end
  const blockRe = /#(graph|table|narrative)\s*(?:\n|\r\n?)([\s\S]*?)(?:\r?\n)?#end\b/gi;
  let blockMatch;
  let blockStripped = rawQuery;
  while ((blockMatch = blockRe.exec(rawQuery)) !== null) {
    const key = blockMatch[1].toLowerCase();
    const content = blockMatch[2].trim();
    if (content) {
      const config = SECTION_DIRECTIVE_CONFIG[key] || { cardinality: 'single', merge: 'override' };
      if (config.cardinality === 'multiple') {
        if (!focus[key]) focus[key] = [];
        focus[key].push(content);
      } else {
        if (config.merge === 'concat' && focus[key]) {
          focus[key] = focus[key] + '\n' + content;
        } else {
          focus[key] = content;
        }
      }
    }
    blockStripped = blockStripped.replace(blockMatch[0], '');
  }

  const intentText = blockStripped.replace(/\s+/g, ' ').trim();

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

  it('ignores inline #graph syntax (no #end required)', () => {
    // Inline syntax is NOT supported — everything stays in intent text
    const result = parseSectionDirectives('Analyze billing #graph: CRM, ERP, ICMS');
    assert.equal(result.intentText, 'Analyze billing #graph: CRM, ERP, ICMS');
    assert.equal(result.sectionFocus, undefined);
  });

  it('parses block-style #graph directive', () => {
    const result = parseSectionDirectives('Analyze billing\n#graph\nCRM\nERP\nICMS\n#end\nfor me');
    assert.equal(result.intentText, 'Analyze billing for me');
    assert.deepEqual(result.sectionFocus, { graph: 'CRM\nERP\nICMS' });
  });

  it('parses block-style #table directive as array', () => {
    const result = parseSectionDirectives(
      'Show me\n#table\ncapabilities, dependencies\n#end',
    );
    assert.equal(result.intentText, 'Show me');
    assert.deepEqual(result.sectionFocus, { table: ['capabilities, dependencies'] });
  });

  it('parses block-style #narrative directive', () => {
    const result = parseSectionDirectives(
      '#narrative\nsummary\n#end\nFull system overview',
    );
    assert.equal(result.intentText, 'Full system overview');
    assert.deepEqual(result.sectionFocus, { narrative: 'summary' });
  });

  it('parses multiple directives (all block style)', () => {
    const result = parseSectionDirectives(
      'System overview\n#graph\nCRM, ERP\n#end\n#table\ncapabilities\n#end\n#narrative\nsummary\n#end',
    );
    assert.equal(result.intentText, 'System overview');
    assert.equal(result.sectionFocus.graph, 'CRM, ERP');
    assert.deepEqual(result.sectionFocus.table, ['capabilities']);
    assert.equal(result.sectionFocus.narrative, 'summary');
  });

  it('ignores unknown directives', () => {
    // Unknown directives are not parsed — the raw text stays in intent
    const result = parseSectionDirectives('#unknown\nvalue\n#end\nWhat is this?');
    assert.equal(result.intentText, '#unknown value #end What is this?');
    assert.equal(result.sectionFocus, undefined);
  });

  it('strips whitespace from intent text', () => {
    const result = parseSectionDirectives('  Analyze   billing  ');
    assert.equal(result.intentText, 'Analyze billing');
    assert.equal(result.sectionFocus, undefined);
  });

  it('multiple #table blocks → array of topics', () => {
    const result = parseSectionDirectives(
      'System overview\n#table\ncapabilities\n#end\n#table\ndependencies\n#end\n#table\nintegrations\n#end',
    );
    assert.equal(result.intentText, 'System overview');
    assert.deepEqual(result.sectionFocus.table, ['capabilities', 'dependencies', 'integrations']);
  });

  it('multiple #graph blocks → concatenated scope', () => {
    const result = parseSectionDirectives(
      'Analyze\n#graph\nCRM, ERP\n#end\n#graph\nthird-party integrations\n#end',
    );
    assert.equal(result.intentText, 'Analyze');
    assert.equal(result.sectionFocus.graph, 'CRM, ERP\nthird-party integrations');
  });

  it('multiple #narrative blocks → concatenated narrative', () => {
    const result = parseSectionDirectives(
      'Analyze\n#narrative\nbusiness impact\n#end\n#narrative\nrisk assessment\n#end',
    );
    assert.equal(result.intentText, 'Analyze');
    assert.equal(result.sectionFocus.narrative, 'business impact\nrisk assessment');
  });

  it('block #table followed by another block #table → merged array', () => {
    const result = parseSectionDirectives(
      'Overview\n#table\ncapabilities\n#end\n#table\ndependencies\n#end',
    );
    assert.equal(result.intentText, 'Overview');
    assert.deepEqual(result.sectionFocus.table, ['capabilities', 'dependencies']);
  });
});
