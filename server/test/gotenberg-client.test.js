import { describe, it, before, after, mock } from 'node:test';
import assert from 'node:assert/strict';

// Set a stable Gotenberg URL for tests before importing the client.
process.env.ARCHITXT_GOTENBERG_URL = 'http://gotenberg-test:3031';

const { convertDocumentToPdf, healthCheck } = await import('../src/services/gotenberg/client.js');

describe('gotenberg client', () => {
  let fetchMock;

  before(() => {
    fetchMock = mock.method(global, 'fetch');
  });

  after(() => {
    mock.restoreAll();
  });

  it('returns a PDF buffer on success', async () => {
    const pdfBytes = Buffer.from('fake pdf content');
    fetchMock.mock.mockImplementation(async () => ({
      ok: true,
      status: 200,
      headers: new Map([['content-type', 'application/pdf']]),
      arrayBuffer: async () => pdfBytes.buffer.slice(pdfBytes.byteOffset, pdfBytes.byteOffset + pdfBytes.byteLength),
    }));

    const result = await convertDocumentToPdf(Buffer.from('docx bytes'), 'test.docx');
    assert.equal(result.success, true);
    assert.ok(result.buffer);
    assert.equal(result.buffer.toString(), 'fake pdf content');
    assert.equal(result.contentType, 'application/pdf');

    const call = fetchMock.mock.calls[0];
    assert.equal(call.arguments[0], 'http://gotenberg-test:3031/forms/libreoffice/convert');
    assert.equal(call.arguments[1].method, 'POST');
  });

  it('returns failure on non-2xx without throwing', async () => {
    fetchMock.mock.mockImplementation(async () => ({
      ok: false,
      status: 503,
      statusText: 'Service Unavailable',
      text: async () => 'libreoffice busy',
    }));

    const result = await convertDocumentToPdf(Buffer.from('docx bytes'), 'test.docx');
    assert.equal(result.success, false);
    assert.ok(result.error.includes('503'));
    assert.ok(result.error.includes('libreoffice busy'));
  });

  it('returns failure on network error without throwing', async () => {
    fetchMock.mock.mockImplementation(async () => {
      throw new Error('fetch failed');
    });

    const result = await convertDocumentToPdf(Buffer.from('docx bytes'), 'test.docx');
    assert.equal(result.success, false);
    assert.equal(result.error, 'fetch failed');
  });

  it('healthCheck returns true on 200', async () => {
    fetchMock.mock.mockImplementation(async () => ({
      ok: true,
      status: 200,
    }));

    const ok = await healthCheck();
    assert.equal(ok, true);
  });

  it('healthCheck returns false on error', async () => {
    fetchMock.mock.mockImplementation(async () => {
      throw new Error('network error');
    });

    const ok = await healthCheck();
    assert.equal(ok, false);
  });
});
