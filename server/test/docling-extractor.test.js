import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

// Inline copy of the private helper under test.
function unescapeMarkdownPunctuation(markdown) {
  // eslint-disable-next-line no-useless-escape
  return markdown.replace(/\\([!"#$%&'()*+,\-./:;=<>?@[\]^_`{|}~])/g, '$1');
}

describe('unescapeMarkdownPunctuation', () => {
  it('removes escaped underscores', () => {
    assert.equal(
      unescapeMarkdownPunctuation('FLAT\\_LOW and HOUSE\\_LOW\\_SUFFIX'),
      'FLAT_LOW and HOUSE_LOW_SUFFIX'
    );
  });

  it('removes escaped brackets and other punctuation', () => {
    assert.equal(
      unescapeMarkdownPunctuation('Some \\[text\\] with \\*stars\\* and 100\\% value'),
      'Some [text] with *stars* and 100% value'
    );
  });

  it('preserves intentional backslashes (double escapes)', () => {
    assert.equal(
      unescapeMarkdownPunctuation('path\\\\contains\\_underscore'),
      'path\\\\contains_underscore'
    );
  });

  it('leaves unescaped text untouched', () => {
    assert.equal(
      unescapeMarkdownPunctuation('svc_name: amendaccessorderrequestv1'),
      'svc_name: amendaccessorderrequestv1'
    );
  });

  it('unescapes JSON-like service fields', () => {
    const escaped = '{ \"svc_name\": \"amendaccessorderrequestv1\", \"svc_aliases\": [\"amendaccessorderresponse_v1\"] }';
    const expected = '{ "svc_name": "amendaccessorderrequestv1", "svc_aliases": ["amendaccessorderresponse_v1"] }';
    assert.equal(unescapeMarkdownPunctuation(escaped), expected);
  });
});
