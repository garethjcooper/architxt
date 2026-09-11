# architxt v0.3.6

## Highlights

v0.3.6 is a **stability and polish release** following the v0.3.5 Research/Explore redesign. It hardens the contextual-graph job pipeline, tightens schema consistency, and polishes the derived mental-model and light-mode experiences.

- **Contextual graph job reliability** — job records now carry an append-only `cgj_logs` column and an `cgj_updated_at` timestamp, replacing the unused `cgj_cancel_requested` flag.
- **Schema consistency** — baseline DDL (`server/sql/architxt_db_schema_ddl.sql`) is once again authoritative for fresh installs, with an additive runtime migration in `ensure-schema.js` for existing databases.
- **Derived mental-model health polish** — green-accented header, consistent button styling, and restored refresh-status tracking.
- **Hindsight sync refinement** — contextual mental models are classified as "On Both" with the correct contextual badge, push/pull disabled for derived/contextual models, and duplicate extracted badges removed from sync rows.
- **Light-mode contrast pass** — opaque status dropdowns and improved badge contrast for upload metadata.

## New features

### Contextual graph jobs

- Add `cgj_logs` JSON column for structured, append-only job logging.
- Add `cgj_updated_at` timestamp column for tracking last job mutation.

## Improvements

### Schema / database

- Align baseline DDL for `contextual_graph_jobs` with the runtime schema used by the server.
- Add additive migration in `ensure-schema.js` so existing databases receive `cgj_logs` and `cgj_updated_at` without rebuilding the table.
- Remove the stale `cgj_cancel_requested` column from fresh-install DDL; leave it untouched in existing databases because SQLite `ALTER TABLE ... DROP COLUMN` is unreliable and no code references it.

### Mental models / Hindsight

- Style the derived mental-model health dialog with green accents and standard buttons.
- Restore refresh-status tracking in the derived health dialog.
- Disable push/pull actions for derived and contextual mental models.
- Classify contextual mental models as "On Both" and show the contextual badge.
- Hide redundant extracted/status badges on documents that are "On Both".
- Batch derived mental-model override saves.

### UI / theming

- Make extraction and hindsight status dropdowns opaque in light mode.
- Improve light-mode badge contrast for upload metadata.
- Show total and selected counts in the mental models tab header.
- Remove redundant graph node/edge count from the Context Patches header.
- Always show composed-query preview for mental model references.
- AQL directives render more vividly in lite/read-only mode.

## Fixes

- Correctly share Mermaid `suppressErrorRendering` config across all render paths.
- `ensure-schema.js` backfills and validates built-in prompt templates and template roles on startup.

## Operations / configuration

- Version bumped to `0.3.6` across root, server, UI, and internal packages (`@architxt/aql`, `@architxt/entity-matcher`).

## Migration notes

- Existing databases will receive the new `contextual_graph_jobs` columns automatically via `ensure-schema.js` on the next startup.
- Fresh installs will use the corrected baseline DDL directly.
- No manual migration is required; the dead `cgj_cancel_requested` column is harmless and intentionally left in place for existing databases.

---

Full diff: `v0.3.5...v0.3.6`.
