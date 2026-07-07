import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildTag,
  findExistingEntityTags,
  stripEntityTags,
  buildCleanToRawMap,
  scanForEntityMatches,
  repairMalformedEntityTags,
  renderEntityTaggedContent,
  hasEntityTags,
} from './index.js';

const v3Format = {
  key: 'v3-single-entity',
  regexSource: '\\[\\[(.*?)\\s*(?:\\(([^)]*)\\))?\\]\\]',
  regexFlags: 'g',
  presentInIndicator: '[[',
};

function entityFixture(overrides = {}) {
  return {
    id: 1,
    entity_id: 'ID-1',
    name: 'foo',
    type_name: 'a-svc',
    aliases: [],
    case_match: 'insensitive',
    type_case_match: 'insensitive',
    word_boundary_match: 'boundaries',
    type_word_boundary_match: 'boundaries',
    ...overrides,
  };
}

describe('buildTag', () => {
  it('builds a v3 tag with type prefix', () => {
    assert.equal(buildTag('foo', 'Foo', 'ID-1', 'a-svc', 'v3-single-entity'), '[[foo (a-svc:ID-1)]]');
  });

  it('builds a v1-dual tag', () => {
    assert.equal(buildTag('foo', 'Foo', 'ID-1', undefined, 'v1-dual'), '[[foo (Foo, ID-1)]]');
  });
});

describe('findExistingEntityTags', () => {
  it('finds valid tags surrounded by non-word characters', () => {
    const content = '"[[foo (a-svc:ID-1)]]", "[[bar (a-svc:ID-2)]]"';
    const tags = findExistingEntityTags(v3Format, content);
    assert.equal(tags.length, 2);
    assert.equal(tags[0].isValid, true);
    assert.equal(tags[1].isValid, true);
  });

  it('flags malformed tags that split a word', () => {
    const content = 'word[[bar (a-svc:ID-2)]]word';
    const tags = findExistingEntityTags(v3Format, content);
    assert.equal(tags.length, 1);
    assert.equal(tags[0].isValid, false);
    assert.equal(tags[0].text, 'bar');
  });

  it('flags malformed tags with nested brackets', () => {
    const content = '[[[x (a-svc:ID-1)]]';
    const tags = findExistingEntityTags(v3Format, content);
    assert.equal(tags.length, 1);
    assert.equal(tags[0].isValid, false);
  });

  it('flags JSON/code blobs as malformed', () => {
    const content = '[[{"svc_name":"foo"}]] and [[{"svc_name":"bar"}]]';
    const tags = findExistingEntityTags(v3Format, content);
    assert.equal(tags.length, 2);
    assert.equal(tags.every((t) => !t.isValid), true);
  });

  it('flags tags with very long inner text as malformed', () => {
    const longName = 'a'.repeat(250);
    const content = `[[${longName} (a-svc:ID-1)]]`;
    const tags = findExistingEntityTags(v3Format, content);
    assert.equal(tags.length, 1);
    assert.equal(tags[0].isValid, false);
  });

  it('flags tags containing line breaks as malformed', () => {
    const content = '[[foo\nbar (a-svc:ID-1)]]';
    const tags = findExistingEntityTags(v3Format, content);
    // The regex does not cross line boundaries, so such tags are not matched at all.
    assert.equal(tags.length, 0);
  });
});

describe('stripEntityTags', () => {
  it('removes well-formed tags and keeps malformed tags as plain text', () => {
    const content = 'aa [[foo (a-svc:ID-1)]] bb word[[bar (a-svc:ID-2)]]word';
    const stripped = stripEntityTags(v3Format, content);
    assert.equal(stripped, 'aa foo bb word[[bar (a-svc:ID-2)]]word');
  });
});

describe('buildCleanToRawMap', () => {
  it('ignores malformed tags and maps clean offsets correctly', () => {
    const content = 'aa [[foo (a-svc:ID-1)]] bb word[[bar (a-svc:ID-2)]]word';
    const map = buildCleanToRawMap(v3Format, content);
    const clean = stripEntityTags(v3Format, content);
    assert.equal(map.length, clean.length + 1);
    // clean: 'aa foo bb word[[bar (a-svc:ID-2)]]word'
    // 'foo' starts at clean index 3, raw index 5 (after "[[")
    assert.equal(map[3], 5);
    // after valid tag, clean index 7 is first 'b' of 'bb' at raw index 24
    assert.equal(map[7], 24);
  });
});

describe('scanForEntityMatches', () => {
  it('returns correct raw offsets for untagged matches around valid tags', () => {
    const entities = [entityFixture({ id: 2, entity_id: 'ID-2', name: 'bar' })];
    const content = '[[foo (a-svc:ID-1)]] and bar here';
    const matches = scanForEntityMatches(v3Format, entities, content);
    const barMatch = matches.find((m) => m.matchedText === 'bar' && !m.fromTag);
    assert.ok(barMatch, 'expected untagged bar match');
    assert.equal(barMatch.rawStartIndex, 25);
    assert.equal(barMatch.rawEndIndex, 28);
  });

  it('does not propose matches inside malformed tags', () => {
    const entities = [entityFixture({ id: 2, entity_id: 'ID-2', name: 'bar' })];
    const content = 'word[[bar (a-svc:ID-2)]]word';
    const matches = scanForEntityMatches(v3Format, entities, content);
    const barMatch = matches.find((m) => m.matchedText === 'bar' && !m.fromTag);
    assert.equal(barMatch, undefined);
  });

  it('handles match at end of content with rawEndIndex sentinel', () => {
    const entities = [entityFixture({ name: 'bar', entity_id: 'ID-2' })];
    const content = '[[foo (a-svc:ID-1)]] bar';
    const matches = scanForEntityMatches(v3Format, entities, content);
    const barMatch = matches.find((m) => m.matchedText === 'bar' && !m.fromTag);
    assert.ok(barMatch);
    assert.equal(barMatch.rawStartIndex, 21);
    assert.equal(barMatch.rawEndIndex, content.length);
  });
});

describe('repairMalformedEntityTags', () => {
  it('strips malformed tags and preserves well-formed tags', () => {
    const content = 'word[[bar (a-svc:ID-2)]]word normal [[foo (a-svc:ID-1)]] end';
    const repaired = repairMalformedEntityTags(v3Format, content);
    assert.equal(repaired, 'wordbarword normal [[foo (a-svc:ID-1)]] end');
  });
});

describe('renderEntityTaggedContent', () => {
  it('renders malformed tags as plain text and valid tags as entities', () => {
    const content = 'word[[bar (a-svc:ID-2)]]word normal [[foo (a-svc:ID-1)]] end';
    const segments = renderEntityTaggedContent(v3Format, content);
    const entitySegments = segments.filter((s) => s.type === 'entity');
    assert.equal(entitySegments.length, 1);
    assert.equal(entitySegments[0].content, 'foo');

    const textSegments = segments.filter((s) => s.type === 'text');
    const malformedText = textSegments.find((s) => s.content.includes('[[bar'));
    assert.ok(malformedText);
  });
});

describe('hasEntityTags', () => {
  it('returns true for content with inserted entity tags', () => {
    assert.equal(hasEntityTags(v3Format, '[[foo (a-svc:ID-1)]]'), true);
  });

  it('returns false for raw [[ markers without entity ids', () => {
    assert.equal(hasEntityTags(v3Format, '[[foo]]'), false);
  });

  it('returns false for plain text', () => {
    assert.equal(hasEntityTags(v3Format, 'foo bar baz'), false);
  });
});
