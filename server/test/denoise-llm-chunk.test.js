import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { chunkMarkdown } from '../src/pipeline/stages/denoise-llm.js';

describe('chunkMarkdown', () => {
  it('returns a single chunk when content is smaller than max size', () => {
    const text = '| a | b |\n|---|---|\n| 1 | 2 |';
    const chunks = chunkMarkdown(text, 50);
    assert.equal(chunks.length, 1);
    assert.equal(chunks[0], text);
  });

  it('splits tables mid-body without dropping rows', () => {
    const text = '| a | b |\n|---|---|\n| 1 | 2 |\n| 3 | 4 |\n| 5 | 6 |\n| 7 | 8 |';
    const chunks = chunkMarkdown(text, 30);
    assert.equal(chunks.length, 2);
    assert.equal(chunks[0], '| a | b |\n|---|---|\n| 1 | 2 |');
    assert.equal(chunks[1], '| 3 | 4 |\n| 5 | 6 |\n| 7 | 8 |');
  });

  it('joins chunks with single newlines to preserve structure', () => {
    const text = '| a | b |\n|---|---|\n| 1 | 2 |\n| 3 | 4 |\n| 5 | 6 |\n| 7 | 8 |';
    const chunks = chunkMarkdown(text, 30);
    const joined = chunks.join('\n');
    assert.equal(joined, text);
    assert.equal([...joined.matchAll(/\n\n/g)].length, 0);
  });

  it('preserves paragraph blank lines after split', () => {
    const text = 'Paragraph one has some text here.\n\nParagraph two has more text.\n\nParagraph three continues.';
    const chunks = chunkMarkdown(text, 60);
    assert.equal(chunks.length, 2);
    const joined = chunks.join('\n');
    assert.equal(joined, text);
  });

  it('respects maxSize and creates smaller chunks for smaller limits', () => {
    const text = Array.from({ length: 10 }, (_, i) => `Line ${i + 1}`).join('\n');
    const chunks = chunkMarkdown(text, 20);
    assert.ok(chunks.every(c => c.length <= 20 + 'Line 10'.length));
  });

  it('ignores leading yaml front matter', () => {
    const text = '---\ntitle: Test\n---\n# Heading\nSome body text.';
    const chunks = chunkMarkdown(text, 1000);
    assert.equal(chunks.length, 1);
    assert.ok(!chunks[0].includes('title:'));
    assert.ok(chunks[0].startsWith('# Heading'));
  });

  it('uses default chunk size of 4000 when maxSize is not provided', () => {
    const text = 'A\n' + 'a'.repeat(5000);
    const chunks = chunkMarkdown(text);
    assert.equal(chunks.length, 2);
  });
});
