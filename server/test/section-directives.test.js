import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { parseSectionDirectives } from '../src/prompts/section-directives.js';

// Also import the backend formatter
const { formatFocusVariable } = await import('../src/prompts/template-service.js');

describe('parseSectionDirectives', () => {
  it('returns empty intent for empty string', () => {
    const result = parseSectionDirectives('');
    assert.equal(result.intentText, '');
    assert.equal(result.sectionFocus, undefined);
  });

  it('parses a single graph block', () => {
    const result = parseSectionDirectives('Analyze billing\n#graph\nCRM, ERP\n#end');
    assert.equal(result.intentText, 'Analyze billing');
    assert.deepEqual(result.sectionFocus?.graph, 'CRM, ERP');
  });

  it('parses a table block with explicit #name', () => {
    const result = parseSectionDirectives('Q\n#table\n#name Billing Dependencies\nUpstreams and downstreams\n#end');
    assert.equal(result.intentText, 'Q');
    const tables = result.sectionFocus?.table;
    assert.equal(tables.length, 1);
    assert.equal(tables[0].name, 'Billing Dependencies');
    assert.equal(tables[0].content, 'Upstreams and downstreams');
  });

  it('parses a table block without #name', () => {
    const result = parseSectionDirectives('Q\n#table\nCapabilities and gaps\n#end');
    assert.equal(result.intentText, 'Q');
    const tables = result.sectionFocus?.table;
    assert.equal(tables.length, 1);
    assert.equal(tables[0].name, undefined);
    assert.equal(tables[0].content, 'Capabilities and gaps');
  });

  it('parses multiple table blocks with and without names', () => {
    const raw = 'Q\n#table\n#name Billing\nInvoices and payments\n#end\n#table\nCapabilities\n#end';
    const result = parseSectionDirectives(raw);
    const tables = result.sectionFocus?.table;
    assert.equal(tables.length, 2);
    assert.equal(tables[0].name, 'Billing');
    assert.equal(tables[0].content, 'Invoices and payments');
    assert.equal(tables[1].name, undefined);
    assert.equal(tables[1].content, 'Capabilities');
  });

  it('parses narrative and graph blocks together', () => {
    const raw = 'Q\n#narrative\nBusiness impact\n#end\n#graph\nCRM, ERP\n#end';
    const result = parseSectionDirectives(raw);
    assert.equal(result.intentText, 'Q');
    assert.equal(result.sectionFocus?.narrative, 'Business impact');
    assert.equal(result.sectionFocus?.graph, 'CRM, ERP');
  });

  it('concatenates multiple graph blocks', () => {
    const result = parseSectionDirectives('Q\n#graph\nA\n#end\n#graph\nB\n#end');
    assert.equal(result.sectionFocus?.graph, 'A\nB');
  });

  it('unknown directives stay as loose text and trigger implicit narrative', () => {
    // #unknown is not parsed; all text is loose text with zero parsed directives,
    // so implicit narrative fires on the whole string.
    const result = parseSectionDirectives('#unknown\nvalue\n#end\nWhat is this?');
    assert.equal(result.intentText, '#unknown value #end What is this?');
    assert.equal(result.sectionFocus?.narrative, '#unknown value #end What is this?');
  });

  it('trims whitespace around the remaining intent text', () => {
    const result = parseSectionDirectives('  Hello   #graph\nA\n#end  ');
    assert.equal(result.intentText, 'Hello');
  });

  it('preserves legacy behavior when #topic is absent', () => {
    // Loose text before directives becomes implicit narrative ONLY when zero
    // explicit directives are present.  With #graph present, implicit narrative
    // is suppressed.
    const result = parseSectionDirectives('Analyze billing\n#graph\nCRM, ERP\n#end');
    assert.equal(result.intentText, 'Analyze billing');
    assert.equal(result.sectionFocus?.graph, 'CRM, ERP');
    assert.equal(result.sectionFocus?.narrative, undefined);
  });

  it('topic fallback when all text is inside a narrative block', () => {
    const result = parseSectionDirectives('#narrative\nTell me about CRM integrations\n#end');
    assert.equal(result.intentText, 'Tell me about CRM integrations');
    assert.equal(result.sectionFocus?.narrative, 'Tell me about CRM integrations');
  });

  it('topic fallback when all text is inside a graph block', () => {
    const result = parseSectionDirectives('#graph\nshow data flows\n#end');
    assert.equal(result.intentText, 'show data flows');
    assert.equal(result.sectionFocus?.graph, 'show data flows');
    assert.equal(result.sectionFocus?.narrative, undefined);
  });

  it('parses inline directives without newlines', () => {
    const result = parseSectionDirectives('what is ICMS #graph show data flows #end #table #name Data Flows list interface name, protocol and destination systems for the data flows #end what is Singleview #table #name table-abc list Singleview capabilities #end');
    assert.equal(result.intentText, 'what is ICMS what is Singleview');
    assert.equal(result.sectionFocus?.graph, 'show data flows');
    assert.equal(result.sectionFocus?.table?.length, 2);
    assert.ok(result.sectionFocus?.table[0].name);
    assert.ok(result.sectionFocus?.table[1].name);
    assert.equal(result.sectionFocus?.narrative, undefined);
  });
});

describe('formatFocusVariable with TableDirective', () => {
  it('renders a table directive with name', () => {
    const out = formatFocusVariable([{ name: 'Billing', content: 'Invoices and payments' }]);
    assert.equal(out, '- **Billing** — Invoices and payments');
  });

  it('renders a table directive without name', () => {
    const out = formatFocusVariable([{ content: 'Capabilities and gaps' }]);
    assert.equal(out, '- Capabilities and gaps');
  });

  it('renders multiple table directives mixed', () => {
    const out = formatFocusVariable([
      { name: 'Billing', content: 'Invoices' },
      { content: 'Gaps' },
    ]);
    assert.equal(out, '- **Billing** — Invoices\n- Gaps');
  });

  it('renders string array as legacy bullets', () => {
    const out = formatFocusVariable(['a', 'b']);
    assert.equal(out, '- a\n- b');
  });

  it('renders plain string as single bullet', () => {
    const out = formatFocusVariable('CRM, ERP');
    assert.equal(out, '- CRM, ERP');
  });
});
