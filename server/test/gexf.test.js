import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { toGEXF } from '../src/utils/gexf.js';

describe('gexf serializer', () => {
  it('produces a well-formed GEXF 1.3 XML document', () => {
    const xml = toGEXF(
      [{ id: 'A', labels: ['Entity'], properties: { name: 'Alpha' } }],
      [],
      { bank_id: 'B' },
      false,
    );
    assert.ok(xml.startsWith('<?xml version="1.0" encoding="UTF-8"?>'));
    assert.ok(xml.includes('xmlns="http://www.gexf.net/1.3"'));
    assert.ok(xml.includes('version="1.3"'));
    assert.ok(xml.includes('defaultedgetype="directed"'));
    assert.ok(xml.includes('<node id="A" label="Alpha">'));
    assert.ok(xml.includes('<attvalue for="architxt-node-label" value="Alpha"/>'));
  });

  it('uses undirected defaultedgetype when requested', () => {
    const xml = toGEXF(
      [{ id: 'A', labels: [], properties: {} }, { id: 'B', labels: [], properties: {} }],
      [{ id: 'e1', source_id: 'A', target_id: 'B', type: null, properties: {} }],
      { bank_id: 'B' },
      true,
    );
    assert.ok(xml.includes('defaultedgetype="undirected"'));
    assert.ok(xml.includes('<edge id="e1" source="A" target="B" type="undirected"'));
  });

  it('escapes XML special characters in labels and string properties', () => {
    const xml = toGEXF(
      [{ id: 'A', labels: [], properties: { name: 'A < B & C"d' } }],
      [],
      { bank_id: 'B' },
      false,
    );
    assert.ok(xml.includes('A &lt; B &amp; C&quot;d'));
  });

  it('sanitizes node and edge ids to valid NMTOKENs', () => {
    const xml = toGEXF(
      [
        { id: 'a <1>', labels: [], properties: {} },
        { id: 'b:2', labels: [], properties: {} },
      ],
      [{ id: 'e&"', source_id: 'a <1>', target_id: 'b:2', type: null, properties: {} }],
      { bank_id: 'B' },
      false,
    );
    // Colon is valid, angle brackets/brackets/ampersand/quote are not.
    assert.ok(xml.includes('<node id="b:2"'));
    assert.ok(!xml.includes('<node id="a <1>"'));
    assert.ok(!xml.includes('source="a <1>"'));
    assert.ok(xml.includes('source="a__1_"'));
    assert.ok(xml.includes('target="b:2"'));
  });

  it('does not duplicate attribute declarations when node properties collide with built-in attributes', () => {
    const xml = toGEXF(
      [{ id: 'A', labels: [], properties: { label: 'Foo' } }],
      [],
      { bank_id: 'B' },
      false,
    );
    const matches = xml.match(/id="architxt-node-label"/g);
    assert.equal(matches?.length, 1, 'built-in node label attribute should be declared exactly once');
  });

  it('JSON-stringifies object and array properties', () => {
    const xml = toGEXF(
      [{ id: 'A', labels: [], properties: { obj: { a: 1 }, arr: [1, 2] } }],
      [],
      { bank_id: 'B' },
      false,
    );
    assert.ok(xml.includes('{\u0026quot;a\u0026quot;:1}'));
    assert.ok(xml.includes('[1,2]'));
  });

  it('declares boolean and numeric properties with the correct GEXF types', () => {
    const xml = toGEXF(
      [{ id: 'A', labels: [], properties: { count: 42, ok: true, score: 1.5 } }],
      [],
      { bank_id: 'B' },
      false,
    );
    assert.ok(xml.includes('type="long"'));
    assert.ok(xml.includes('title="count"'));
    assert.ok(xml.includes('type="boolean"'));
    assert.ok(xml.includes('title="ok"'));
    assert.ok(xml.includes('type="double"'));
    assert.ok(xml.includes('title="score"'));
    assert.ok(xml.includes('<attvalue for="count" value="42"/>'));
    assert.ok(xml.includes('<attvalue for="ok" value="true"/>'));
    assert.ok(xml.includes('<attvalue for="score" value="1.5"/>'));
  });

  it('does not emit empty attvalue elements for typed attributes with null values', () => {
    const xml = toGEXF(
      [
        { id: 'A', labels: [], properties: { count: 1 } },
        { id: 'B', labels: [], properties: { count: null } },
      ],
      [],
      { bank_id: 'B' },
      false,
    );
    const countMatches = xml.match(/for="count" value="\d+"/g);
    assert.equal(countMatches?.length, 1);
  });

  it('exports edge type and label as attributes and attvalues', () => {
    const xml = toGEXF(
      [{ id: 'A', labels: [], properties: {} }, { id: 'B', labels: [], properties: {} }],
      [{ id: 'e1', source_id: 'A', target_id: 'B', type: 'RELATES_TO', properties: {} }],
      { bank_id: 'B' },
      false,
    );
    assert.ok(xml.includes('type="directed"'));
    assert.ok(xml.includes('label="RELATES_TO"'));
    assert.ok(xml.includes('<attvalue for="architxt-type" value="RELATES_TO"/>'));
    assert.ok(xml.includes('<attvalue for="architxt-edge-label" value="RELATES_TO"/>'));
  });

  it('per-edge directed property overrides the default', () => {
    const xml = toGEXF(
      [{ id: 'A', labels: [], properties: {} }, { id: 'B', labels: [], properties: {} }],
      [
        {
          id: 'e1',
          source_id: 'A',
          target_id: 'B',
          type: null,
          properties: { directed: false },
        },
      ],
      { bank_id: 'B' },
      false,
    );
    assert.ok(xml.includes('defaultedgetype="directed"'));
    assert.ok(xml.includes('<edge id="e1" source="A" target="B" type="undirected"'));
  });

  it('deduplicates nodes by id', () => {
    const xml = toGEXF(
      [
        { id: 'A', labels: ['One'], properties: {} },
        { id: 'A', labels: ['Two'], properties: {} },
      ],
      [],
      { bank_id: 'B' },
      false,
    );
    const nodeMatches = xml.match(/<node id="A"/g);
    assert.equal(nodeMatches?.length, 1);
  });
});
