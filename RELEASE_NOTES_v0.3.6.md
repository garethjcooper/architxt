# architxt v0.3.6 — feat/v36

## Highlights

v0.3.6 is a major release centered on **contextual graph management**, **mental-model templating**, and **Hindsight synchronization**. It replaces the old Explore/Research surfaces with a unified Context Patches (contextual-graph) experience, introduces template roles for derived/contextual mental models, and ships a complete sync pipeline to Hindsight-backed corpora.

## New features

### Context Patches / Contextual Graph

- **Working graph CRUD** — new `contextual_graph_nodes` and `contextual_graph_edges` tables with identity-based deduplication, role-aware patch health, and provenance tracking.
- **Add-context orchestrator** — imports a Hindsight skeleton graph into the working graph and queues entity-context, edge-context, and discovery mental models.
- **Refresh lifecycle** — semantically-driven refresh gate; re-run models when divergence is detected; force-refresh option for stuck refs.
- **Sync jobs** — tracked `contextual_graph_jobs` table with stage-by-stage `cgj_logs`, `cgj_updated_at`, and a jobs tab/log viewer in the UI.
- **Bank configuration** — per-server contextual-graph bank config with auto/manual sync badges, safe auto-defaults, restriction controls, and cleanup options.
- **Graph renderer** — shared graph viewer with entity/edge lists, health filters, color-by-health edges/nodes, controls, drag-resizable data box, and vertical resize handle.
- **Patch health view** — surface per-ref refresh state, partial failures, and issue counts in card badges.
- **Data box** — Data and Patch Config tabs, table-to-markdown rendering, stored properties, and patch provenance.
- **Mental models tab** — split-pane model list with fetched content panel inside the context manager.

### Template Roles

- **New `template_roles` table and management page** — create, edit, and delete custom template roles with derivation scope (NODE / EDGE / SEED).
- **Built-in `user_entity_derived` role** — seeded system role for entity-derived mental models.
- **Role-based validation** — contextual template format validation and create/edit guards based on the selected template role.
- **Unique role constraint** — one template role per mental model; display role badges and scope consistently across lists and detail views.
- **System template hygiene** — lock system template names, gate system-template UI controls, guard `ext_id`, and disallow user tags on system-owned templates.

### Mental Models

- **Template-role driven models** — models created from custom template roles compose previews via the system-template path.
- **Derived model panel** — restored and generalized for all entity templates, not only `user_entity_derived`.
- **Query preview** — moved into model list rows with copy/download controls; enabled for plain and system-template models.
- **Refresh status tracking** — derived health dialog tracks and shows refresh status.
- **Role/scope badges** — consistent emerald-green scope badges; template role shown in contextual data panel and mental-models list.
- **Save UX** — Name remains editable after save; External ID read-only; batch derived override saves.

### Hindsight Sync

- **Unified diff/sync** — `deriveMentalModels` and `composeDerivedMentalModels` shared between server and sync UI.
- **Contextual classification** — contextual mental models classified as "On Both" with the correct contextual badge.
- **Push/pull restrictions** — disabled for derived and contextual mental models to prevent accidental mutation.
- **Clean-all action** — clear all mental models from a Hindsight bank from the Graph Banks dialog.
- **Conflict handling** — create-or-update mental models on `409` / already-exists responses.

### Research / Workspace

- **Unified envelope** — research handlers now return `narratives[]` with inferred `narrative_name`; legacy synthesis/canvas columns removed.
- **Workspace redesign** — removed legacy Research and Explore pages; shared components relocated and reused.
- **Diagram interaction** — grab pan enabled by default, explicit Fit / Actual size buttons, mouse-wheel zoom, fit-to-page behavior fixes.

### UI / Theming

- **Light mode** — new palette and theme toggle across the app.
- **Semantic variables** — complete migration from hardcoded brand/neutral colors to semantic CSS variables for surfaces, accents, focus rings, badges, status colors, scrollbars, and Mermaid/AQL chrome.
- **Green accent unification** — primary green used consistently for focus rings, Apply/Save/Run buttons, derived-health headers, and mental-model scope badges.
- **Badge polish** — badge-entity family, neutralized low-impact count/type badges, improved light-mode contrast.
- **Opaque dropdowns/menus** — extraction/hindsight status dropdowns, add-section-to-page dialog, image review modal, and dropdown menus are opaque in both themes.
- **Native selects** — replaced Base UI selects inside dialogs with native selects to avoid portal/focus issues.

## Improvements

### Schema / database

- Align baseline DDL for `contextual_graph_jobs` with the runtime schema (`cgj_logs`, `cgj_updated_at`; stale `cgj_cancel_requested` removed from fresh-install DDL).
- Additive migration in `ensure-schema.js` so existing databases receive `cgj_logs` and `cgj_updated_at` without a table rebuild.
- `ensure-schema.js` backfills and validates built-in prompt templates and template roles on startup.
- Delete stale contextual-graph templates so canonical seeded templates take effect.

### Contextual Graph reliability

- Deterministic directed edge ids with label hash for parallel edges.
- Keep edges distinct by `(source, target, type)` when applying edge context.
- Robust JSON extraction for refresh patches — sanitize smart quotes, markdown tables, non-breaking hyphens, and no-break spaces.
- Fail refresh on normalize errors; force refresh to recover stuck refs.
- Avoid double-counting sync-job issues in card badges.
- Discovery no longer overwrites canonical node names/types and no longer emits known-known edges.
- Preserve seed refs and merge discovery output instead of overwriting.
- Edge-context apply creates missing nodes and edges from model output.
- Prefix working-graph node ids with entity type; preserve label during Hindsight import.
- Support multiple mental-model refs per working-graph node/edge.

### Template / prompt hygiene

- `{id}` placeholder migrated to `{entity-id}` across templates and mental models.
- `{id}` substitution available for non-system derived templates.
- System template prompts placed before fragments so the task leads.
- Tighter edge-context prompts: plural flows, strict bidirectional, evidence-only.
- `ARCHITXT_CORPUS` made optional for contextual templates.
- Narrative name inferred from body and normalized on read/write.

### Nav / labeling

- Renamed Models → Mental Models.
- Renamed Hindsight → Hindsight Sync.
- Renamed Context Manager → Context Patches.
- Reordered nav: Context Patches, Mental Models, Hindsight Sync, Contexts, Template Roles, Directives, Servers.

## Fixes

- **Schema race**: `table documents already exists` in full parallel test suite is a pre-existing race on the shared SQLite database; isolated schema and contextual-graph tests pass.
- **Mermaid**: share `suppressErrorRendering` config across all render paths.
- **AQL**: directives render more vividly in lite/read-only mode.
- **Template-role fetch failures**: isolated so display lookup survives.
- **Model-form**: role-select flicker fixed; Entity Template slider decoupled from default role.
- **Graph Banks dialog**: Cancel/Save sticky; native select for Mode.
- **Select portals**: portal popups and keyboard-only focus ring to avoid dialog clipping.
- **Context-manager**: restore scrolling in mental-models content panel.
- **Research sessions**: keyed by `(server_id, bank_id)` with normalized bank-scoped routes.

## Operations / configuration

- Version bumped to `0.3.6` across root, server, UI, and internal packages (`@architxt/aql`, `@architxt/entity-matcher`).
- Docker Compose image tag updated to `architxt:0.3.6`.
- Generated `version.json` updated to `0.3.6`.

## Migration notes

- Existing databases receive the new `contextual_graph_jobs` columns automatically via `ensure-schema.js` on the next startup.
- Fresh installs use the corrected baseline DDL directly.
- The dead `cgj_cancel_requested` column is harmless and intentionally left untouched in existing databases because SQLite `ALTER TABLE ... DROP COLUMN` is unreliable and no code references it.
- System templates are re-seeded on startup; custom user templates are preserved.

---

Full diff: `v0.3.5...v0.3.6`.
