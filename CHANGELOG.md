# Changelog

All notable changes to architxt are documented in this file.

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
