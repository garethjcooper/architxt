# Component Design: Document Processing Service

## Overview

The Document Processing Service is responsible for ingesting raw documents from multiple sources, transforming them into structured markdown, and preparing them for downstream denoising, vision analysis, and entity detection. It is the foundational stage of the architxt extraction pipeline.

## Scope

This design covers the ingestion pipeline from file receipt through to structured markdown output. It does not cover the LLM-based denoising stage or the vision analysis stage, which are consumed as downstream services by the extract daemon.

---

## Business Capability Mapping

| Component | Business Capability |
|---|---|
| Document Processing Service | Ingest and classify enterprise documentation |
| Ingestion Controller | Normalize unstructured content into structured formats |
| File Store | Secure document storage and version management |

---

## Architecture

The Document Processing Service is composed of three primary application services and consumes one external integration component.

### Component Diagram

```
┌─────────────────────────────────────────────────────────┐
│          Document Processing Service                   │
├─────────────────────────────────────────────────────────┤
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐  │
│  │ Ingestion    │→│ Denoise      │→│ Vision       │  │
│  │ Controller   │  │ Transformer  │  │ Analyzer     │  │
│  └──────┬───────┘  └──────────────┘  └──────────────┘  │
│         │                                                │
│         ↓                                                │
│  ┌──────────────┐                                        │
│  │ File Store   │                                        │
│  └──────────────┘                                        │
└─────────────────────────────────────────────────────────┘
         │
         ↓
┌─────────────────────────────────────────────────────────┐
│  Docling Python Service                                 │
│  Port 5001, exposes /convert endpoint                   │
└─────────────────────────────────────────────────────────┘
```

---

## Ingestion Flow

### Step 1: Receipt

When a document is uploaded via the UI or API, the Ingestion Controller performs the following:

1. **Validate** — File extension, MIME type, and size against configured max file size
2. **Hash** — Compute SHA-256 content hash for deduplication and integrity
3. **Store** — Persist raw bytes to the configured storage path via the File Store
4. **Queue** — Insert an `uploaded` row into the documents table; the extract daemon picks this up

Supported formats:
- **PDF** (preferred) — text extraction via Docling, optional OCR fallback
- **DOCX** — Office Open XML parsing via Docling
- **XLSX** — Spreadsheet ingestion (minimal testing; may lose formatting)
- **PPTX** — Slide deck ingestion (minimal testing; text only)
- **Images** (PNG, JPG) — Direct routing to vision pipeline; bypass Docling

### Step 2: Docling Conversion

The extract daemon invokes the external Docling service at the configured service URL:

```
POST /convert
Content-Type: multipart/form-data

file: <raw bytes>
force_ocr: true|false
```

Response:
```json
{
  "markdown": "# Heading\\n\\nParagraph text...",
  "pages": 12,
  "images": [
    {"page": 3, "id": "img_001", "bbox": [100, 200, 400, 500]}
  ],
  "tables": [
    {"page": 5, "id": "tbl_001", "rows": 10, "cols": 4}
  ]
}
```

When force OCR is enabled, the service runs Tesseract on every page before text extraction. This eliminates glyph artifacts caused by subsetted fonts lacking ToUnicode CMaps.

### Step 3: Normalization

The Denoise Transformer cleans the raw markdown:

| Rule | Description |
|---|---|
| Non-ASCII strip | Remove/replace characters above 0x7F |
| Artifact cleanup | Fix intermittent spaces, hyphenation breaks |
| Boilerplate removal | Strip headers, footers, page numbers, table of contents |
| Image description | Inline `[image: description]` for non-tabular images |
| Table extraction | Convert screenshot tables to markdown tables |
| Whitespace normalize | Collapse multiple newlines to configured maximum |

### Step 4: Vision Analysis

The Vision Analyzer processes embedded images and diagrams:

1. **Architecture diagrams** — Extract Systems Inventory + Connection Mappings tables
2. **Data tables** — Convert to markdown tables (if Docling missed them)
3. **Screenshots/logos** — Summarize as `[image: brief description]`
4. **Diagram descriptions** — Generate textual descriptions for LLM downstream consumption

Vision uses the configured vision provider and model. Default is Ollama Cloud with ministral-3:14b-cloud.

### Step 5: Entity Detection

The final pipeline stage scans normalized markdown for known entity patterns using regex generated from the active entity label definitions in the entities table.

Detected entities are embedded inline as textual references.

---

## Data Model

### Document Lifecycle States

| State | Meaning | Set By |
|---|---|---|
| `uploaded` | File received, awaiting extraction | Ingestion Controller |
| `extracting` | Docling conversion in progress | Extract Daemon |
| `denoising` | Text normalization running | Extract Daemon |
| `vision` | Image/diagram analysis running | Extract Daemon |
| `entity_detecting` | Entity scanning running | Extract Daemon |
| `completed` | All stages successful | Extract Daemon |
| `failed` | One or more stages errored | Extract Daemon |
| `claimed` | User has claimed for review | UI/API |
| `ready` | User marked ready for downstream | UI/API |

### Key Tables

```sql
-- documents: core document record
CREATE TABLE documents (
  doc_id INTEGER PRIMARY KEY,
  doc_title TEXT NOT NULL,
  doc_filename TEXT NOT NULL,
  doc_content TEXT,
  doc_status TEXT CHECK(doc_status IN (
    'uploaded','extracting','denoising','vision',
    'entity_detecting','completed','failed','claimed','ready'
  )),
  doc_content_hash TEXT UNIQUE NOT NULL,
  doc_source_path TEXT NOT NULL,
  doc_uploaded_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- processing_history: audit trail of pipeline runs
CREATE TABLE processing_history (
  hist_id INTEGER PRIMARY KEY,
  hist_doc_id INTEGER REFERENCES documents(doc_id),
  hist_stage TEXT NOT NULL,
  hist_status TEXT NOT NULL,
  hist_started_at DATETIME,
  hist_completed_at DATETIME,
  hist_error_message TEXT
);
```

---

## Configuration

```bash
# Server
ARCHITXT_PORT=3000
ARCHITXT_MAX_FILE_SIZE=104857600

# Storage
ARCHITXT_STORAGE_PATH=./documents
ARCHITXT_TEMP_DIR=./tmp

# Docling
DOCLING_SERVICE_URL=http://localhost:5001
ARCHITXT_DOCLING_FORCE_OCR=false

# Denoise
ARCHITXT_DENOISE_ENABLED=true
ARCHITXT_DENOISE_REMOVE_PAGE_NUMBERS=1
ARCHITXT_DENOISE_REMOVE_CONFIDENTIAL=1
ARCHITXT_DENOISE_REMOVE_DOC_IDS=1
ARCHITXT_DENOISE_UNESCAPE_HTML=1
ARCHITXT_DENOISE_NORMALIZE_WS=1
ARCHITXT_DENOISE_REMOVE_NON_ASCII=1
ARCHITXT_DENOISE_MAX_NEWLINES=3

# Vision
ARCHITXT_VISION_ENABLED=true
ARCHITXT_VISION_PROVIDER=ollama_cloud
ARCHITXT_VISION_MODEL=ministral-3:14b-cloud
ARCHITXT_VISION_TIMEOUT_MS=300000

# Daemon
ARCHITXT_EXTRACT_DAEMON_POLL_INTERVAL_MS=5000
ARCHITXT_EXTRACT_DAEMON_ORPHAN_THRESHOLD_MINUTES=600
```

---

## Interfaces

### Ingestion Controller to File Store

```javascript
// write(buffer, filename): Promise<{path, size}>
const { path, size } = await fileStore.write(uploadedBuffer, 'invoice_v3.pdf');

// read(sourcePath): Promise<Buffer>
const buffer = await fileStore.read(document.doc_source_path);

// delete(sourcePath): Promise<void>
await fileStore.delete(document.doc_source_path);
```

### Extract Daemon to Docling Service

```javascript
// convert(fileBuffer, options): Promise<DoclingResult>
const result = await doclingService.convert(buffer, {
  forceOcr: config.docling.forceOcr,
  timeoutMs: config.docling.timeoutMs
});

interface DoclingResult {
  markdown: string;
  pages: number;
  images: Array<{
    page: number;
    id: string;
    bbox: [number, number, number, number];
  }>;
  tables: Array<{
    page: number;
    id: string;
    rows: number;
    cols: number;
  }>;
}
```

### Extract Daemon to Vision Service

```javascript
// describe(imageBuffer, context): Promise<Description>
const description = await visionService.describe(imageBuffer, {
  pageNumber: 3,
  documentTitle: 'Architecture Overview'
});

interface Description {
  type: 'diagram' | 'table' | 'screenshot' | 'logo';
  summary: string;
  extractedTables?: Array<string>; // markdown
  systemsInventory?: Array<{
    name: string;
    type: 'system' | 'database' | 'service' | 'external' | 'process';
    description: string;
  }>;
  connectionMappings?: Array<{
    from: string;
    to: string;
    flow: string;
    direction: '->' | '<-' | '<->' | '-';
  }>;
}
```

---

## Error Handling

| Scenario | Behavior | Retry |
|---|---|---|
| Docling service unreachable | Mark failed, log error, retry next poll cycle | Yes (daemon poll) |
| Docling returns 422 (bad format) | Mark failed, store error, no retry | No |
| Vision timeout | Mark stage failed, continue with remaining images | Partial |
| Disk full (File Store) | Reject upload, return 507 to client | N/A |
| Hash collision (duplicate) | Return existing document ID, no re-ingestion | N/A |

---

## Security Considerations

1. **File validation** — MIME type checked against extension; mismatch rejects upload
2. **Path traversal** — Source path is internally generated (UUID + sanitized filename); user-provided filenames never touch the filesystem directly
3. **Size limits** — Max file size enforced before buffering to disk
4. **Temp cleanup** — Temp files older than orphan threshold auto-deleted by daemon
5. **No execution** — Uploaded files are never executed; only read by Docling and vision pipelines

---

## Performance Targets

| Metric | Target | Notes |
|---|---|---|
| Ingestion throughput | 10 docs/minute | Single-threaded daemon, local Docling |
| Max file size | 100MB | Configurable |
| Docling conversion | ~2 sec/page | Depends on OCR setting |
| Vision analysis | ~5 sec/image | Varies by provider/model |
| End-to-end pipeline | ~30 sec for 10-page PDF | No vision, no OCR |

---

## Known Limitations

1. **XLSX/PPTX** — Testing is minimal. Complex formatting, charts, and macros are lost.
2. **Scanned PDFs** — Require force OCR enabled; slower but accurate
3. **Handwritten content** — Not supported by Docling; vision may capture some as description
4. **Password-protected files** — Rejected at ingestion
5. **Embedded video/audio** — Ignored entirely

---

*Document ID: CD-DOCPROC-2024-001*

*Component: Document Processing Service*

*Services: Ingestion Controller, Denoise Transformer, Vision Analyzer, File Store*

*Capabilities: Ingest and classify enterprise documentation, Normalize unstructured content into structured formats, Secure document storage and version management*

*Author: System Architect*

*Date: 2024-03-15*
