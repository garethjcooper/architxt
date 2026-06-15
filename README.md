# architxt

**Turn messy documents into queryable knowledge.**

architxt is a document processing pipeline and web UI that ingests documents — extracts structured content via an LLM-augmented pipeline (Docling, denoising, vision analysis, entity detection) — and produces clean, versioned, entity-tagged knowledge. Results can be reviewed, edited, and pushed to a [Hindsight](https://github.com/vectorize-io/hindsight/tree/main) memory bank for enterprise-scale semantic search, mental models, and cross-document reasoning.

**PDF is the preferred format.** DOCX, XLSX, and PPTX are also supported but have received minimal testing.

It is built on the idea of the [Temporal Mosaic](docs/concepts/architxt-temporal-mosaic.md): the "best known state" of a system is not a single document, but a composite of the freshest knowledge for each scope — regardless of when the document was written.

<p align="center">
  <img src="docs/designs/architxt-user-sml.gif" width="800" alt="architxt in action" />
</p>

---

## Table of Contents

- [Prerequisites](#prerequisites)
- [Installation](#installation)
- [Quick Start](#quick-start)
- [Basic Workflows](#basic-workflows)
- [Updating](#updating)
- [Uninstallation](#uninstallation)
- [What Am I Looking At?](#what-am-i-looking-at)
- [Scripts Reference](#scripts-reference)
- [Configuration](#configuration)
- [The Daemons](#the-daemons)
- [Docling](#docling)
- [Database](#database)
- [API Documentation](#api-documentation)
- [Development Workflow](#development-workflow)
- [Troubleshooting](#troubleshooting)
- [Tech Stack](#tech-stack)
- [License](#license)

---

## Prerequisites

| Requirement | Minimum | Notes |
|---|---|---|
| **Node.js** | 22.0.0 | Required for native ESM, `fetch`, and `better-sqlite3` binary compatibility |
| **npm** | 10.0.0 | Bundled with Node.js 22+ |
| **git** | 2.30+ | For cloning and updates |
| **(Optional) Ollama** | Latest | For local LLM inference. Install from [ollama.com](https://ollama.com) |
| **(Optional) Docling** | Latest | Run `docling serve` for document parsing. See [Docling setup](#docling) |

**At least one LLM provider must be configured.** architxt supports four provider types out of the box:
- **Ollama Local** — self-hosted models via `http://localhost:11434`
- **Ollama Cloud** — managed Ollama endpoint with API key
- **OpenAI Compatible** — any OpenAI-style API (OpenAI, Azure, custom proxies)
- **Anthropic** — Claude models via Anthropic's API

Verify Node.js:
```bash
node --version   # Should print v22.x.x or higher
npm --version    # Should print 10.x.x or higher
```

If Node.js is too old, install via [nvm](https://github.com/nvm-sh/nvm):
```bash
nvm install 22
nvm use 22
```

---

## Installation

### 1. Clone the repository

```bash
git clone <repo-url> && cd architxt
```

### 2. Run setup

```bash
npm run setup
```

This one command handles everything:

| Step | What happens |
|---|---|
| Node version check | Exits with clear error if < 22 |
| `npm install` in `server/` | Backend dependencies (Express, SQLite, etc.) |
| `npm install` in `ui/` | Frontend dependencies (Next.js, React, Tailwind, etc.) |
| Create directories | `database/`, `documents/`, `logs/`, `tmp/` |
| Copy `.env` template | `server/.env.example` → `server/.env` **(only if missing)** |
| Build UI | Static export to `ui/dist/` |

**Important:** `setup` creates `server/.env` from the template, but the template contains placeholder API keys. You **must** edit `server/.env` before starting the server or it will fail on missing required values.

### 3. Configure environment

Edit `server/.env` and set at minimum:

```bash
# Required — at least one LLM provider must be configured
ARCHITXT_OLLAMA_LOCAL_URL=http://localhost:11434
ARCHITXT_OLLAMA_CLOUD_API_KEY=your-key-here   # or set OpenAI/Anthropic keys

# Verify these paths are sensible for your system
ARCHITXT_DB_PATH=./database/architxt.db
ARCHITXT_STORAGE_PATH=./documents
```

The backend uses **fail-fast config validation** — missing required variables cause immediate exit with a clear error message. There are no silent fallbacks.

### 4. Start the application

```bash
npm start
```

Open your browser to `http://localhost:3000`.

---

## Quick Start

If prerequisites are already met and you don't need the explanations:

```bash
git clone <repo-url> && cd architxt
npm run setup       # installs deps, creates dirs, builds UI
# Edit server/.env — add your API keys
npm start           # starts backend + UI on http://localhost:3000
```

---

## Basic Workflows

The quickest way to understand architxt is to walk through a complete document lifecycle.

### 1. Upload a Document

- Open `http://localhost:3000` → **Documents** page
- Click **Upload** → drag/drop or select a document (PDF preferred; DOCX, XLSX, PPTX also accepted)
- The document appears in the list with status `uploaded`

### 2. Extract Content

The **Extract Daemon** (running in the background) automatically picks up `uploaded` documents:

```
Docling → Denoise → Vision → Entity Detection
```

- Watch the **status badge** on the document row — it transitions through `extracting` → `denoising` → `vision` → `entity_detecting` → `completed`
- The extracted structured content is now stored in the document

### 3. Review & Smart Edit

- Click a document → open the **detail view**
- Switch to the **Smart** tab to see the document broken into editable blocks (headings, text, images)
- Edit individual blocks inline, delete irrelevant sections, or restore from the change log
- Click **Save** to commit your edits

### 4. Run Entity Detection

- In the document detail view, click **Entity Detection**
- The system scans the document for known entity patterns (systems, services, capabilities) and highlights matches
- Review the detected entities and confirm or adjust the findings
- Entity tags are embedded in the document content for downstream recall

### 5. Push to Hindsight

- Go to **Hindsight** → **Sync** page
- Select a configured Hindsight server and bank
- Click **Diff** to see what's on architxt vs what's already on Hindsight
- Push documents and entity labels from architxt to Hindsight in one operation
- The poll daemon tracks operation status automatically; badges update from `pending` → `completed`

---

## Updating

When a new version is available (`git pull`, branch switch, or manual download):

### Standard update (preserves data)

```bash
# 1. Pull latest code
git pull origin main

# 2. Re-run setup to catch new dependencies
npm run setup

# 3. (Optional) Rebuild UI if frontend changed
npm run build

# 4. Start as normal
npm start
```

### What `npm run setup` does on an existing install

`setup` is **idempotent** — safe to run multiple times:

| Step | First run | Update run |
|---|---|---|
| Node check | Validates version | Validates version |
| `npm install` | Full install | Updates changed packages only |
| Create dirs | Creates missing dirs | Skips existing dirs |
| Copy `.env` | Creates from `.env.example` | **Skips** — never overwrites your `.env` |
| Build UI | Full build | Full build |

**`.env` is never overwritten.** If the update introduces new required environment variables, the backend will exit on startup with a message like `MISSING_VAR: ARCHITXT_NEW_SETTING`. Add the missing variable to `server/.env` (check `.env.example` for the template) and restart.

### Database migrations

Database schema updates are applied automatically on server startup. No manual migration step is required.

---

## Uninstallation

Three levels of removal are available, depending on how thorough you want to be.

### Level 1: `npm run clean` — Wipe Data, Keep Code

Deletes all runtime-generated files while preserving source code, configuration, and installed dependencies:

```bash
npm run clean
```

**Removes:**
- `database/` — SQLite DB and WAL files
- `documents/` — Uploaded files and conversions
- `logs/` — Application logs
- `tmp/` — Temporary processing files
- `ui/dist/` — Built static UI artifacts

**Keeps:**
- Source code, `.env`, `node_modules` (no reinstall needed)

**After running:**
```bash
npm run setup   # recreate empty DB + seed data
npm run build   # rebuild static UI
npm start       # back in business
```

### Level 2: `npm run purge` — Full Reset (Back to Fresh Clone)

Same as `clean`, plus removes dependencies. Returns the repo to a clean checkout state:

```bash
npm run purge
```

**Removes everything `clean` removes, plus:**
- `ui/.next/` — Next.js build cache
- `node_modules/` — All installed dependencies (root, `server/`, `ui/`)
- `package-lock.json` files

**Prompts before deleting:**
- `server/.env` — your local secrets and settings. Confirm with `y` to delete, or `N` to keep.

**After running:**
```bash
npm run setup   # reinstall everything + empty DB + seed data
```

### Level 3: Manual Uninstall

If you didn't customize any environment variables to external paths, just delete the project folder:

```bash
rm -rf /path/to/architxt
```

**External paths:** If you set `ARCHITXT_DB_PATH`, `ARCHITXT_LOG_DIR`, `ARCHITXT_STORAGE_PATH`, or `ARCHITXT_TEMP_DIR` to locations **outside** the repo, those files and directories remain after `rm -rf` and must be cleaned up manually. Check `server/.env` to see if any paths point outside the project directory.

---

## What Am I Looking At?

architxt is **two Node.js applications** that work together. They live in separate directories because they have different jobs and different lifecycles, but a root-level orchestrator hides that complexity from you.

### Directory Structure

```
architxt/
├── package.json            ← Root orchestrator (this is what you run)
├── README.md               ← You are here
├── scripts/
│   ├── setup.js            ← First-time environment setup
│   ├── build.js            ← Builds the UI for production
│   ├── start.js            ← Starts everything in production mode
│   ├── dev.js              ← Starts everything in development mode
│   ├── clean.js            ← Wipes runtime data, keeps code
│   └── purge.js            ← Full reset including dependencies
│
├── server/                 ← BACKEND (Express + SQLite + Daemons)
│   ├── package.json
│   ├── src/
│   │   ├── index.js        ← Main server (API routes, static UI serving)
│   │   ├── config.js       ← All configuration (env vars, LLM providers, prompts)
│   │   ├── routes/         ← REST API endpoints (/documents, /tags, /hindsight, ...)
│   │   ├── db/             ← SQLite schema, CRUD layer, connection
│   │   ├── services/       ← Pipeline stages, LLM clients, extraction logic
│   │   ├── daemons/        ← Background worker processes
│   │   │   ├── extract-daemon.js      ← Polls DB, runs document pipeline
│   │   │   └── hindsight-poll-daemon.js ← Syncs with Hindsight servers
│   │   └── swagger.js      ← OpenAPI/Swagger spec generator
│   └── .env.example        ← Template for local secrets/settings
│
├── ui/                     ← FRONTEND (Next.js + React + Tailwind)
│   ├── package.json
│   ├── next.config.ts      ← Static export config (output: 'export')
│   ├── app/                ← Next.js App Router pages
│   │   ├── page.tsx        ← Dashboard / landing
│   │   ├── documents/      ← Document list, upload, review
│   │   ├── contexts/       ← Document grouping contexts
│   │   ├── tags/           ← Tag management
│   │   ├── metadata/       ← Metadata key-value management
│   │   ├── entities/       ← Entity (named-thing) management
│   │   ├── servers/        ← Hindsight server configuration
│   │   ├── hindsight/      ← Hindsight sync dashboard
│   │   └── settings/       ← Application settings
│   ├── components/         ← Reusable dialogs, panels, buttons
│   ├── lib/
│   │   └── api/client.ts   ← Typed HTTP client for all backend APIs
│   └── dist/               ← Static HTML output (created by `npm run build`)
│
└── test-assets/            ← Sample files for testing
```

### The Two Apps Explained

| Aspect | `server/` (Backend) | `ui/` (Frontend) |
|---|---|---|
| **Runtime** | Node.js 22+ (long-running process) | Next.js 16 (builds to static HTML) |
| **Port** | 3000 (HTTP server) | None (served by backend in production) |
| **Data** | SQLite file (`database/architxt.db`) | No data; all state in backend |
| **Daemons** | Forks extract + hindsight poll workers | N/A |
| **Role** | REST API, file storage, pipeline execution, database | Visual interface: tables, forms, dialogs |
| **Talks to** | SQLite, LLM APIs, Docling service, Hindsight servers | Backend via HTTP (`/api/*`) |

### How They Talk

In **development** (`npm run dev`):
- Backend runs on `http://localhost:3000`
- UI dev server runs on `http://localhost:3001`
- UI uses Next.js rewrites to proxy `/api/*` → `http://localhost:3000/api/v1/*`

In **production** (`npm start`):
- Only the backend runs (port 3000)
- Backend serves the pre-built UI as static files from `ui/dist/`
- API calls go directly to `/api/*` on the same server — no proxy needed
- This is why end users only need one URL: `http://localhost:3000`

---

## Scripts Reference

All scripts are run from the **project root** (the directory containing this `README.md`).

| Command | When to use | What happens |
|---|---|---|
| `npm run setup` | First time, or after `git pull` that adds new deps | Installs deps, creates dirs, copies `.env` (if missing), builds UI |
| `npm start` | Running the app "for real" | Builds UI if needed, starts backend on `:3000` |
| `npm run dev` | Active development / debugging | Backend on `:3000`, UI hot-reload on `:3001` |
| `npm run build` | Rebuild UI after changing frontend code | Runs `next build` in `ui/` → outputs `ui/dist/` |
| `npm run clean` | Wipe all data, keep code and deps | Deletes `database/`, `documents/`, `logs/`, `tmp/`, `ui/dist/` |
| `npm run purge` | Nuclear reset — back to fresh clone | Same as clean **plus** `node_modules/` and lockfiles. Prompts before deleting `.env` |
| `npm run lint` | Check code quality | Runs ESLint in both `server/` and `ui/` |

---

## Configuration

All settings are in `server/.env` (copied from `.env.example` during setup).

**Critical values to set before first use:**

| Variable | Purpose | Example |
|---|---|---|
| `ARCHITXT_PORT` | Backend HTTP port | `3000` |
| `ARCHITXT_DB_PATH` | SQLite database file | `./database/architxt.db` |
| `ARCHITXT_STORAGE_PATH` | Uploaded documents folder | `./documents` |
| `ARCHITXT_OLLAMA_LOCAL_URL` | Local Ollama instance | `http://localhost:11434` |
| `ARCHITXT_OLLAMA_CLOUD_API_KEY` | Ollama Cloud API key | `sk-...` |
| `ARCHITXT_OPENAI_API_KEY` | OpenAI API key (optional) | `sk-...` |
| `ARCHITXT_ANTHROPIC_API_KEY` | Anthropic API key (optional) | `sk-ant-...` |

**LLM Provider quick reference:**

| Provider | Required variable(s) | Where to get a key |
|---|---|---|
| Ollama Local | `ARCHITXT_OLLAMA_LOCAL_URL` | No key needed — runs on your machine |
| Ollama Cloud | `ARCHITXT_OLLAMA_CLOUD_API_KEY` | [ollama.com](https://ollama.com) |
| OpenAI Compatible | `ARCHITXT_OPENAI_API_KEY` | [platform.openai.com](https://platform.openai.com) |
| Anthropic | `ARCHITXT_ANTHROPIC_API_KEY` | [console.anthropic.com](https://console.anthropic.com) |

The backend loads these via `server/src/config.js`, which enforces fail-fast validation — missing required vars cause the server to exit immediately with a clear error.

---

## The Daemons

The backend forks two background processes on startup:

1. **Extract Daemon** (`src/daemons/extract-daemon.js`)
   - Polls the database every 5 seconds for documents with `status = 'uploaded'`
   - Runs them through the pipeline: Docling → Denoise → Vision → Entity Detection
   - Updates document status and extracted content in the database

2. **Hindsight Poll Daemon** (`src/daemons/hindsight-poll-daemon.js`)
   - Polls configured Hindsight servers for pending operations
   - Pushes/pulls documents and entity labels as configured

Both can be disabled via environment variables:
```bash
SPAWN_EXTRACT_DAEMON=false
SPAWN_HINDSIGHT_POLL_DAEMON=false
```

---

## Docling

The extract pipeline's first stage uses [Docling](https://github.com/DS4SD/docling) to parse PDFs, Word documents, and images into structured text. architxt expects Docling to be running as a **standalone server** via the `docling serve` command.

### Setup

```bash
# 1. Install Docling (requires Python 3.10–3.12)
pip install docling

# 2. Start the server (default port 5001)
docling serve
```

### Configure architxt

In `server/.env`, point to the Docling server:

```bash
DOCLING_SERVICE_URL=http://localhost:5001
```

### Force OCR

If your PDFs contain subsetted fonts without ToUnicode CMaps (causing `glyph` artifacts like `/g###/` tokens in extracted text), enable forced OCR:

```bash
ARCHITXT_DOCLING_FORCE_OCR=true
```

This is slower but eliminates text corruption for problematic PDFs.

---

## Database

architxt uses **SQLite** (via `better-sqlite3`) — zero setup, single file.

Key tables:
- `documents` — uploaded files, processing status, extracted content
- `contexts` — document groupings
- `tags` / `document_tags` — user-defined labels
- `metadata` / `document_metadata` — key-value pairs
- `entities` / `entity_types` — named-thing extraction targets
- `servers` / `pending_operations` — Hindsight sync state
- `processing_history` — audit log of pipeline stage runs

Database initialization happens automatically on first server start.

---

## API Documentation

Interactive Swagger UI is available at `http://localhost:3000/api-docs` when the server is running.

All endpoints are under `/api/v1/`:
- `/documents` — CRUD, upload, processing workflow, tags, metadata
- `/contexts` — Document grouping contexts
- `/tags` — Tag definitions
- `/metadata` — Metadata definitions
- `/entities` / `/entities/types` — Entity extraction config
- `/servers` — Hindsight server connections
- `/hindsight` — Sync operations (diff, push, pull, compare)
- `/config` — Runtime configuration discovery

---

## Development Workflow

```bash
# 1. Start everything in dev mode (two ports, hot reload)
npm run dev

# 2. Open UI at http://localhost:3001
#    Backend API visible at http://localhost:3000/api-docs

# 3. Make changes to UI code → browser refreshes automatically
#    Make changes to server code → restart manually (nodemon not installed)

# 4. When done, build for production
npm run build
```

---

## Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| `npm run setup` fails with Node version error | Node < 22 | `nvm install 22 && nvm use 22` |
| `npm start` says UI not built | `ui/dist/` missing | Run `npm run build` |
| Port 3000 already in use | Another process | Change `ARCHITXT_PORT` in `server/.env` |
| Backend starts but UI is blank | `ui/dist/` incomplete or missing | Run `npm run build` again |
| API calls return 404 | Backend not running, or wrong port | Check `npm start` output; verify `ARCHITXT_PORT` |
| Daemons not running | `SPAWN_*_DAEMON=false` set | Remove those env vars or set to `true` |
| `ERR_DLOPEN_FAILED` from better-sqlite3 | Node version changed since `npm install` | Run `cd server && npm rebuild` |
| `npm run setup` warns about unsupported engine | Server wants Node 24 but root wants 22 | Safe to ignore; both work on Node 22+ |
| Backend exits with `MISSING_*` error | `.env` missing or incomplete | Edit `server/.env`; add missing variable from `.env.example` |

---

## Tech Stack

- **Runtime:** Node.js 22+ (ESM modules)
- **Backend:** Express 4, better-sqlite3, multer, winston, swagger-jsdoc
- **Frontend:** Next.js 16, React 19, TypeScript, Tailwind CSS 4, shadcn/ui
- **Database:** SQLite (better-sqlite3)
- **Document Processing:** Docling (Python service, optional external), LLM vision APIs

---

## License

Copyright 2025 Gareth Cooper

Licensed under the Apache License, Version 2.0. See [LICENSE](./LICENSE) for full terms.
