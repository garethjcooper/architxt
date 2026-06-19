# Changelog

All notable changes to architxt are documented in this file.

## [0.2.1] - 2026-06-19

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
