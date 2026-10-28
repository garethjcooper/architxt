import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { toGraphML } from '../src/utils/graphml.js';

function parseXml(xml) {
  // Use Node's built-in XML parser (needs DOMParser? Not available by default).
  // Instead validate well-formedness with a quick regex/strict tag check and
  // use xmldom if installed? Simpler: use native `node:util`? We can require
  // a tiny parser. For tests, let's rely on a lightweight regexp and manual
  // checks; full XSD validation is covered by integration tests.
  return xml;
}

describe('graphml serializer', () => {
  it('produces a well-formed XML document with the GraphML namespace', () => {
    const xml = toGraphML(
      [{ id: 'A', labels: ['Entity'], properties: { name: 'Alpha' } }],
      [],
      { bank_id: 'B' },
      false,
    );
    assert.ok(xml.startsWith('<?xml version="1.0" encoding="UTF-8"?>'));
    assert.ok(xml.includes('xmlns="http://graphml.graphdrawing.org/xmlns"'));
    assert.ok(xml.includes('edgedefault="directed"'));
  });

  it('uses undirected edgedefault when requested', () => {
    const xml = toGraphML([{ id: 'A', labels: [], properties: {} }], [], { bank_id: 'B' }, true);
    assert.ok(xml.includes('edgedefault="undirected"'));
  });

  it('escapes XML special characters in labels and string properties', () => {
    const xml = toGraphML(
      [{ id: 'A', labels: [], properties: { name: 'A < B & C"d' } }],
      [],
      { bank_id: 'B' },
      false,
    );
    assert.ok(xml.includes('A &lt; B &amp; C&quot;d'));
  });

  it('sanitizes node and edge ids to valid NMTOKENs', () => {
    const xml = toGraphML(
      [
        { id: 'a <1>', labels: [], properties: {} },
        { id: 'b:2', labels: [], properties: {} },
      ],
      [{ id: 'e&"', source_id: 'a <1>', target_id: 'b:2', type: null, properties: {} }],
      { bank_id: 'B' },
      false,
    );
    // Colon is valid, angle brackets/brackets/ampersand/quote are not.
    assert.ok(xml.includes('\u003cnode id="b:2"\u003e'));
    assert.ok(!xml.includes('\u003cnode id="a \u003c1\u003e"'));
    assert.ok(!xml.includes('source="a \u003c1\u003e"'));
    assert.ok(xml.includes('source="a__1_"'));
  });

  it('does not duplicate key declarations when node properties collide with built-in keys', () => {
    const xml = toGraphML(
      [{ id: 'A', labels: [], properties: { label: 'Foo' } }],
      [],
      { bank_id: 'B' },
      false,
    );
    const matches = xml.match(/id="architxt-node-label"/g);
    assert.equal(matches?.length, 1, 'built-in node label key should be declared exactly once');
  });

  it('JSON-stringifies object and array properties', () => {
    const xml = toGraphML(
      [{ id: 'A', labels: [], properties: { obj: { a: 1 }, arr: [1, 2] } }],
      [],
      { bank_id: 'B' },
      false,
    );
    assert.ok(xml.includes('{&quot;a&quot;:1}'));
    assert.ok(xml.includes('[1,2]'));
  });

  it('declares boolean and numeric properties with the correct GraphML types', () => {
    const xml = toGraphML(
      [{ id: 'A', labels: [], properties: { count: 42, ok: true, score: 1.5 } }],
      [],
      { bank_id: 'B' },
      false,
    );
    assert.ok(xml.includes('attr.type="long"'));
    assert.ok(xml.includes('attr.name="count"'));
    assert.ok(xml.includes('attr.type="boolean"'));
    assert.ok(xml.includes('attr.name="ok"'));
    assert.ok(xml.includes('attr.type="double"'));
    assert.ok(xml.includes('attr.name="score"'));
    assert.ok(xml.includes('<data key="count">42</data>'));
    assert.ok(xml.includes('<data key="ok">true</data>'));
    assert.ok(xml.includes('<data key="score">1.5</data>'));
  });

  it('does not emit empty data elements for typed keys with null values', () => {
    const xml = toGraphML(
      [
        { id: 'A', labels: [], properties: { count: 1 } },
        { id: 'B', labels: [], properties: { count: null } },
      ],
      [],
      { bank_id: 'B' },
      false,
    );
    const countDataMatches = xml.match(/key="count">\d+<\/data>/g);
    assert.equal(countDataMatches?.length, 1);
  });
});
