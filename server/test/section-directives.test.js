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

  it('parses a diagram block with explicit #name and #type', () => {
    const result = parseSectionDirectives('Q\n#diagram\n#name Billing flow\n#type flowchart\nA --> B\n#end');
    assert.equal(result.intentText, 'Q');
    const diagrams = result.sectionFocus?.diagram;
    assert.equal(diagrams.length, 1);
    assert.equal(diagrams[0].name, 'Billing flow');
    assert.equal(diagrams[0].type, 'flowchart');
    assert.equal(diagrams[0].content, 'A --> B');
  });

  it('parses a diagram-only block and derives topic from name and type', () => {
    const result = parseSectionDirectives('#diagram\n#name test1\n#type erDiagram\nICMS ||--|| Singleview : dataflow\n#end');
    assert.equal(result.intentText, 'test1 (erDiagram)');
    assert.equal(result.sectionFocus?.narrative, undefined);
    const diagrams = result.sectionFocus?.diagram;
    assert.equal(diagrams.length, 1);
    assert.equal(diagrams[0].name, 'test1');
    assert.equal(diagrams[0].type, 'erDiagram');
    assert.equal(diagrams[0].content, 'ICMS ||--|| Singleview : dataflow');
  });

  it('parses a table-only block and derives topic from name', () => {
    const result = parseSectionDirectives('#table\n#name Billing\nlist interface name and protocol\n#end');
    assert.equal(result.intentText, 'Billing');
    assert.equal(result.sectionFocus?.narrative, undefined);
    const tables = result.sectionFocus?.table;
    assert.equal(tables.length, 1);
    assert.equal(tables[0].name, 'Billing');
    assert.equal(tables[0].content, 'list interface name and protocol');
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

  it('rejects unknown directives as invalid AQL', () => {
    // AQL is strict: #unknown is not a valid directive so it produces errors.
    // The body line 'value' is treated as loose text (no open block) and the
    // text after the block becomes the intent.
    const result = parseSectionDirectives('#unknown\nvalue\n#end\nWhat is this?');
    assert.equal(result.intentText, 'value What is this?');
    assert.deepEqual(result.sectionFocus, {});
  });

  it('trims whitespace around the remaining intent text', () => {
    const result = parseSectionDirectives('  Hello\n#graph\nA\n#end  ');
    assert.equal(result.intentText, 'Hello');
  });

  it('does not create implicit narrative when an explicit directive is present', () => {
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

  it('ignores inline single-line directive blocks', () => {
    const raw = 'what is ICMS #diagram #name Seq #type sequenceDiagram Alice->>Bob: Hello #end explain';
    const result = parseSectionDirectives(raw);
    // Inline blocks are not recognized because each keyword must start on its own line.
    assert.equal(result.intentText, 'what is ICMS #diagram #name Seq #type sequenceDiagram Alice->>Bob: Hello #end explain');
    assert.equal(result.sectionFocus?.diagram, undefined);
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

  it('renders diagram directives with name and type', () => {
    const out = formatFocusVariable([
      { name: 'Billing flow', type: 'flowchart', content: 'A --> B' },
    ]);
    assert.equal(out, '- **Billing flow** (flowchart) — A --> B');
  });

  it('renders diagram directives without name', () => {
    const out = formatFocusVariable([
      { type: 'sequenceDiagram', content: 'Alice->>Bob' },
    ]);
    assert.equal(out, '- (sequenceDiagram) — Alice->>Bob');
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
