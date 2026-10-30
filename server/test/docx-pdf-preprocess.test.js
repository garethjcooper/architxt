import { describe, it, before, after, mock } from 'node:test';
import assert from 'node:assert/strict';

process.env.ARCHITXT_GOTENBERG_URL = 'http://gotenberg-test:3031';

const configMod = await import('../src/config.js');
const config = configMod.config;

const { extract } = await import('../src/services/docling/extractor.js');

describe('docx pdf preprocessing', () => {
  let fetchMock;
  let fetchCallCount;

  before(() => {
    fetchCallCount = 0;
    fetchMock = mock.method(global, 'fetch', async (url) => {
      fetchCallCount++;
      const urlString = String(url);
      if (urlString.includes('/forms/libreoffice/convert')) {
        throw new Error('should not be called');
      }
      if (urlString.includes('/v1/convert/file')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            status: 'success',
            document: {
              md_content: '# Test\n\ndirect\n![Image](data:image/png;base64,1111111111)',
              json_content: { pages: [] },
            },
            processing_time: 1.0,
          }),
        };
      }
      throw new Error(`unexpected url: ${urlString}`);
    });
    config.gotenberg.convertDocDocxToPdf = true;
    config.gotenberg.convertHtmlToPdf = true;
    config.gotenberg.convertPptPptxToPdf = true;
  });

  after(() => {
    mock.restoreAll();
  });

  function makeDoclingResponse(markdown, imageCount = 0) {
    const images = Array.from({ length: imageCount }, (_, i) =>
      `![Image](data:image/png;base64,${i.toString().repeat(10)})`
    ).join('\n');
    return {
      status: 'success',
      document: {
        md_content: `# Test\n\n${markdown}\n${images}`,
        json_content: { pages: [] },
      },
      processing_time: 1.0,
    };
  }

  it('preprocesses .docx to PDF before sending to Docling', async () => {
    fetchCallCount = 0;
    fetchMock.mock.mockImplementation(async (url) => {
      fetchCallCount++;
      const urlString = String(url);
      if (urlString.includes('/forms/libreoffice/convert')) {
        const pdfBytes = Buffer.from('%PDF-1.4 fake');
        return {
          ok: true,
          status: 200,
          headers: new Map([['content-type', 'application/pdf']]),
          arrayBuffer: async () => pdfBytes.buffer.slice(pdfBytes.byteOffset, pdfBytes.byteOffset + pdfBytes.byteLength),
        };
      }
      if (urlString.includes('/v1/convert/file')) {
        return {
          ok: true,
          status: 200,
          json: async () => makeDoclingResponse('from pdf', 2),
        };
      }
      throw new Error(`unexpected url: ${urlString}`);
    });

    const result = await extract(Buffer.from('docx bytes'), 'report.docx');
    assert.equal(result.metadata.preprocessed_to_pdf, true);
    assert.equal(result.images.length, 2);
    assert.ok(fetchCallCount >= 2);

    const doclingCall = fetchMock.mock.calls.find(c => String(c.arguments[0]).includes('/v1/convert/file'));
    const body = doclingCall.arguments[1].body;
    assert.ok(body instanceof FormData);
  });

  it('preprocesses .html to PDF before sending to Docling', async () => {
    fetchCallCount = 0;
    fetchMock.mock.mockImplementation(async (url) => {
      fetchCallCount++;
      const urlString = String(url);
      if (urlString.includes('/forms/libreoffice/convert')) {
        const pdfBytes = Buffer.from('%PDF-1.4 fake');
        return {
          ok: true,
          status: 200,
          headers: new Map([['content-type', 'application/pdf']]),
          arrayBuffer: async () => pdfBytes.buffer.slice(pdfBytes.byteOffset, pdfBytes.byteOffset + pdfBytes.byteLength),
        };
      }
      if (urlString.includes('/v1/convert/file')) {
        return {
          ok: true,
          status: 200,
          json: async () => makeDoclingResponse('from html pdf', 1),
        };
      }
      throw new Error(`unexpected url: ${urlString}`);
    });

    const result = await extract(Buffer.from('<h1>hello</h1>'), 'page.html');
    assert.equal(result.metadata.preprocessed_to_pdf, true);
    assert.equal(result.images.length, 1);
    assert.ok(fetchCallCount >= 2);

    const doclingCall = fetchMock.mock.calls.find(c => String(c.arguments[0]).includes('/v1/convert/file'));
    const body = doclingCall.arguments[1].body;
    assert.ok(body instanceof FormData);
  });

  it('falls back to direct Docling when Gotenberg fails', async () => {
    fetchCallCount = 0;
    fetchMock.mock.mockImplementation(async (url) => {
      fetchCallCount++;
      const urlString = String(url);
      if (urlString.includes('/forms/libreoffice/convert')) {
        return {
          ok: false,
          status: 500,
          statusText: 'Internal Server Error',
          text: async () => 'boom',
        };
      }
      if (urlString.includes('/v1/convert/file')) {
        return {
          ok: true,
          status: 200,
          json: async () => makeDoclingResponse('direct docx', 3),
        };
      }
      throw new Error(`unexpected url: ${urlString}`);
    });

    const result = await extract(Buffer.from('docx bytes'), 'report.docx');
    assert.equal(result.metadata.preprocessed_to_pdf, false);
    assert.equal(result.images.length, 3);
  });

  it('skips preprocessing for non-target formats', async () => {
    fetchCallCount = 0;
    const result = await extract(Buffer.from('pdf bytes'), 'report.pdf');
    assert.equal(result.metadata.preprocessed_to_pdf, false);
    assert.equal(fetchCallCount, 1);
  });

  it('preprocesses .pptx to PDF before sending to Docling', async () => {
    fetchCallCount = 0;
    fetchMock.mock.mockImplementation(async (url) => {
      fetchCallCount++;
      const urlString = String(url);
      if (urlString.includes('/forms/libreoffice/convert')) {
        const pdfBytes = Buffer.from('%PDF-1.4 fake');
        return {
          ok: true,
          status: 200,
          headers: new Map([['content-type', 'application/pdf']]),
          arrayBuffer: async () => pdfBytes.buffer.slice(pdfBytes.byteOffset, pdfBytes.byteOffset + pdfBytes.byteLength),
        };
      }
      if (urlString.includes('/v1/convert/file')) {
        return {
          ok: true,
          status: 200,
          json: async () => makeDoclingResponse('from pptx pdf', 2),
        };
      }
      throw new Error(`unexpected url: ${urlString}`);
    });

    const result = await extract(Buffer.from('pptx bytes'), 'slides.pptx');
    assert.equal(result.metadata.preprocessed_to_pdf, true);
    assert.equal(result.images.length, 2);
    assert.ok(fetchCallCount >= 2);

    const doclingCall = fetchMock.mock.calls.find(c => String(c.arguments[0]).includes('/v1/convert/file'));
    const body = doclingCall.arguments[1].body;
    assert.ok(body instanceof FormData);
  });

  it('preprocesses .ppt to PDF before sending to Docling', async () => {
    fetchCallCount = 0;
    fetchMock.mock.mockImplementation(async (url) => {
      fetchCallCount++;
      const urlString = String(url);
      if (urlString.includes('/forms/libreoffice/convert')) {
        const pdfBytes = Buffer.from('%PDF-1.4 fake');
        return {
          ok: true,
          status: 200,
          headers: new Map([['content-type', 'application/pdf']]),
          arrayBuffer: async () => pdfBytes.buffer.slice(pdfBytes.byteOffset, pdfBytes.byteOffset + pdfBytes.byteLength),
        };
      }
      if (urlString.includes('/v1/convert/file')) {
        return {
          ok: true,
          status: 200,
          json: async () => makeDoclingResponse('from ppt pdf', 1),
        };
      }
      throw new Error(`unexpected url: ${urlString}`);
    });

    const result = await extract(Buffer.from('ppt bytes'), 'legacy.ppt');
    assert.equal(result.metadata.preprocessed_to_pdf, true);
    assert.equal(result.images.length, 1);
    assert.ok(fetchCallCount >= 2);

    const doclingCall = fetchMock.mock.calls.find(c => String(c.arguments[0]).includes('/v1/convert/file'));
    const body = doclingCall.arguments[1].body;
    assert.ok(body instanceof FormData);
  });

  it('skips preprocessing when PPT/PPTX feature is disabled', async () => {
    fetchCallCount = 0;
    config.gotenberg.convertPptPptxToPdf = false;
    const result = await extract(Buffer.from('pptx bytes'), 'slides.pptx');
    assert.equal(result.metadata.preprocessed_to_pdf, false);
    assert.equal(fetchCallCount, 1);
    config.gotenberg.convertPptPptxToPdf = true;
  });
});
