# Changelog

All notable changes to architxt are documented in this file.

## [0.4.6] - 2026-10-20

> ⚠️ **Important:** After upgrading, open **Settings → Server → Banks** and click **Clean local graph** for each bank, then run **Sync local graph** again. This ensures your local context graph is rebuilt cleanly with the corrected edge-detail hashing and entity ID canonicalisation introduced in this release.

### Added
- Views page **Save to workspace** now supports three export formats: **Flowchart**, **Graph**, and **Table**.
  - All formats share the same **Send to** modal and target page.
  - **Flowchart** remains selected by default; at least one format must be chosen.
  - When multiple formats are selected they are merged into the same target page envelope.
- **Graph** export produces a canonical `type: 'graph'` envelope from the current view.
- **Table** export produces node and edge tables using the same row/column layout as the Graph focus modal's **Add table to page** action.
- Server banks dialog now includes a **Clean local graph** button to remove stale contextual graph data.

### Changed
- Views export events are regenerated from the current picker format selection at apply time, so toggling formats inside the modal always matches the saved output.
- The canonical directed edge ID hash now includes edge `detail`, making graph identity stable when edge detail changes.

### Fixed
- Views graph export to workspace and Mermaid export now use canonical entity IDs consistently.

## [0.4.5] - 2026-10-19

### Added
- Workspace chat AQL threads: dedicated `aql1`, `aql2`, … threads that generate structured AQL queries from plain intent.
- Server-side AQL builder in Workspace chat returns a wrapped, readable **Generated AQL** block with every response.
- **Copy AQL to Reflect input** action on generated AQL output, with a standard confirmation dialog when Reflect input is not empty.
- **Preview prompt** button on Reflect, Recall, and Synthesize query forms showing the fully composed prompt before it is sent.
- Chat option switches: **Parse Entities** and **Contextual List** for normal chat threads.

### Changed
- AQL mode is now a thread type rather than a per-message toggle.
- Generated AQL output is wrapped for readability and the explanation moved into the chat input placeholder.
- Default Reflect mission wording expanded to cover components, data flows, risks & constraints, sizing, and system purpose & capabilities; existing banks are migrated on startup.
- Reflect handler composes the prompt from the raw query, matching the preview behaviour.
- Output directives are generated dynamically from active section-focus directives instead of static placeholders.

### Fixed
- Prompt composition only loads narrative-generation rules when no section directives are present or narrative is explicitly active.
- Views graph export to workspace and Mermaid export now use canonical entity IDs consistently.
- Narrative sections hide the evidence icon when no evidence exists.
- Removed accidentally committed SQLite database and added `.gitignore` protection.

## [0.4.4] - 2026-10-10

### Added
- Documentation site landing page refresh:
  - New hero tagline **"architxt: unlock the doc"** with IT-architecture focused copy.
  - Screenshot carousel on the intro page showing document import, workspace curation, and grounded views.
- Retain dry-run runs can be saved, loaded, deleted, and exported as markdown with a run label.
- UI: compact single-line dry-run toolbar with a running-man icon and persistent suffix input.
- UI: reset button returns retain dry-run to bank defaults without clearing the panel.
- Server: persisted retain dry-run runs with `retain-runs` CRUD routes and swagger docs.

### Changed
- Default environment values in `server/src/config.js` updated for the current Ollama Cloud model set:
  - `ARCHITXT_DENOISE_LLM_MODEL`: `gpt-oss:120b-cloud`
  - `ARCHITXT_DENOISE_LLM_TIMEOUT_MS`: `1200000`
  - `ARCHITXT_DENOISE_LLM_TEMPERATURE`: `0.0`
  - `ARCHITXT_DIAGRAM_BATCH_SIZE`: `1`
  - `ARCHITXT_CONTEXTUAL_GRAPH_SYNC_DAEMON_ENABLED`: `true`
- UI: saved-runs dropdown widened to 360px and switched to native select for stable form behaviour.
- Retain run labels removed from saved-runs dropdown labels and API input for cleaner UX.
- Extraction reset now re-derives bank defaults (mission, mode, labels) instead of clearing them.

### Fixed
- Retain runs route correctly mounted and returns a plain array.
- Single retain run fetched correctly by unwrapping the `dbExec` wrapper.
- Default extraction mode resets to Bank on Reset and after Delete.
- Base UI select edge cases resolved by using `null` for unselected retain-run values.

## [0.4.0] - 2026-09-17

### Added
- Workspace: "+ New page" option when adding a section to a curated page, which creates the page, opens it, and applies the section in one flow.
- Workspace: Escape key dismisses the add-section-to-page target picker.
- Graph evidence is copied into diagram and table sections when added to a curated page.

### Changed
- Graph and diagram focus modals now open with fit-to-page enabled by default.
- Graph-generated Mermaid flowcharts no longer emit the deprecated `%%{init: {'layout': 'elk'}}%%` directive.

### Fixed
- Race condition when applying a copied section to a newly created curated page: the page tab is now opened immediately and the trail refreshed before applying content.

## [0.3.9] - 2026-09-??

### Added
- Hindsight sync: `Directives` as a fourth syncable object type with diff, push, pull, and side-by-side compare modal
- Directives: architxt directives now require `dir_name` and keep `dir_ext_id` as an optional Hindsight-generated id only
- Mental models: new `exact` tag match mode (sent as lowercase `exact` to the API)

### Changed
- Mental model `mm_tags_match_mode`, `mm_refresh_mode`, and `mm_ent_refresh_mode` values are now validated at application level instead of by SQLite CHECK constraints
- Database migration (`ensureSchema`) recreates mental model tables without CHECK constraints and preserves junction rows (`mental_model_tags`, `mental_model_entities`)

### Fixed
- Hindsight directive push no longer sends `ext_id` when creating a new bank directive
- Diff correctly lists architxt-only directives that have not yet been pushed (synthetic local key when `dir_ext_id` is null)

### Removed
- Stale broken pipeline harness files `server/test-pipeline.js` and `server/test-pipeline.mjs`

## [0.2.0] - 2026-06-18

### Added
- Mental models: local-first template + derived-instance workflow with full-row-state per-entity config
- Mental models: Hindsight sync (diff, push, pull, compare modal) for plain and derived rows
- Hindsight sync: read-only entity label diff and push/pull between architxt entities/types and Hindsight bank config
- Settings page with server configuration viewer and restart action
- Configurable max file upload size via `ARCHITXT_MAX_FILE_SIZE` (env-driven, exposed in settings)
- Multi-select data table helpers and bulk-action patterns across documents, tags, and mental models
- `?summary=true` mode on `/hindsight/diff` for lightweight divergence counts
- ConfirmDialog component for destructive actions, replacing native `window.confirm()`

### Changed
- Improved entity list and Hindsight diff performance with FTS5 batched usage counts
- Settings/config routes now read values fail-fast from the config object without silent fallbacks
- Document processing pipeline now uses background daemon polling instead of frontend poll loops
- Stage runner signature alignment across pipeline stages
- README: added divergent-branch recovery instructions for in-place updates

### Fixed
- Fresh-install crash: `ensureSchema()` now applies base DDL before running additive FTS migration
- Removed `|| 5000` fallback on database `timeout_ms`
- Next.js dev proxy body-size limit raised to 100 MB to match backend upload limit
- SQLite JSON boolean normalization for per-entity mental-model overrides
- Various UI polish: table resizing, page header consistency, dialog layouts

### Removed
- `POST /hindsight/operations/poll` route (daemon now handles polling)
- Frontend `pollOperations` loop and related API client method

## [0.1.0] - 2026-06-10

### Added
- Root-level orchestration layer for single-command setup and run:
  - `package.json` with `setup`, `build`, `start`, `dev`, `lint` scripts
  - `scripts/setup.js` — Node version check, dependency install, directory creation, `.env` copy, UI build
  - `scripts/build.js` — UI production static export trigger
  - `scripts/start.js` — Production runner (single backend process serves UI)
  - `scripts/dev.js` — Two-process dev mode with graceful cleanup
- Database auto-creation on first boot:
  - `server/src/db/ensure-schema.js` — detects schema, applies DDL from `sql/architxt_db_schema_ddl.sql`
  - `server/src/db/ensure-seed.js` — detects system seed data, applies from `sql/seed_data.sql`
  - `server/src/db/connection.js` calls both on every boot
- Seed data moved from JavaScript to SQL:
  - `server/sql/seed_data.sql` — idempotent `INSERT OR IGNORE` for 8 system metadata presets
- UI static export for single-port production:
  - `ui/next.config.ts` — `output: 'export'`, `distDir: 'dist'`, unoptimized images
  - `server/src/index.js` — Express serves `ui/dist/` with SPA fallback
- Safe database reset:
  - `server/scripts/init-db.js` — non-destructive by default, `--force` for full wipe
  - `server/package.json` — `db:init` and `db:reset` scripts

### Changed
- Aligned Node engine requirement to `>=22.0.0` across root and server `package.json`
- Removed legacy `server/src/seed/metadata.js` (functionality moved to SQL + `ensure-seed.js`)

### Fixed
- Metadata table CHECK constraint on `meta_generated_by` now includes `'system'` alongside `'user'` and `'import'`

### Removed
- Legacy `backend/` directory (empty source files, superseded by `server/`)

## [Pre-0.1.0] — Prior Development

- Express backend with document processing pipeline
- Next.js frontend with shadcn/ui components
- SQLite database with WAL mode
- Swagger/OpenAPI documentation
- Hindsight integration for vector memory
- Entity tag format v2-single
