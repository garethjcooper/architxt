# Release Notes — architxt v0.4.7

**Branch:** `feat/v047`  
**Tag target commit:** TBD after merge  
**Release date:** 2026-10-24

> ⚠️ **Important:** After upgrading, open **Settings → Server → Banks** and click **Clean local graph** for each bank, then run **Sync local graph** again. This ensures your local context graph is rebuilt cleanly with the deterministic edge identity, directed-edge handling, and canonical entity/edge resolution introduced in this release.

## Highlights

- **Add to view** flow is now fully server-side: parsed entities, deterministic edge resolution, and candidate selection for unresolved edges.
- Views can be created directly from the **Add to View** modal with a canonical view graph.
- Diagram and graph prompts now use canonical entity references and plain `type:id` labels.
- Edge-context mental models are consumed from structured tables, making parallel/distinguished edges stable.

## New Features

- **Add to View modal — server-side entity/edge resolution**
  - Parses nodes and edges for graph, diagram, table, and narrative sections.
  - Resolves nodes to canonical `type:id` form.
  - Resolves typed and typeless edges by endpoint pair and label, with reversed-orientation fallback.
  - Shows closest candidate edges for unresolved matches, sorted by Jaro-Winkler similarity.
  - Multi-select checkboxes for nodes and edges; related edges enable/disable automatically.
- **Create view from Add to View modal**
  - Produces a canonical view graph from the selected nodes/edges.
  - Keeps the modal open after creation and shows a summary toast.
- **Views entity-panel edge grouping**
  - Edges are grouped by directed endpoint pair.
  - Real source/target direction is preserved when rendering.
  - Edge detail is read from stored contextual-graph properties.
- **Edge-context mental model — table-based output**
  - Replaces the previous free-text edge-context prompt with a structured table-based query.
  - Parallel edges are distinguished by label/detail.
  - Edge-context edges are applied when the content hash changes.
- **Diagram prompt hygiene**
  - Fragments and examples use canonical `type:id` references.
  - Mermaid labels use plain `type:id` labels; entity-reference format is forbidden inside labels.
- **Workspace section toolbar**
  - Move section action icons from the sidebar into the rendered heading rows.
  - Send-to-view action is scoped to graph/diagram sections.

## Changed

- `AddToViewModal` uses standard project Table components and a resizable two-pane layout.
- Edge resolution is deterministic and server-side; endpoint-only fallbacks have been removed.
- Views exports use directed signatures for edge-context table filtering.
- Edge-context table filtering is tightened by label and selected edges.
- Default Reflect mission wording expanded; existing banks are migrated on startup.
- Hindsight image pinned to `1.1.0` in `docker-compose.yml`.

## Fixed

- Edge identity now honors model-asserted direction and distinguishes parallel edges.
- Skeleton edges are replaced cleanly on edge-context apply instead of being mutated.
- Edge-context edges no longer overwrite each other on fresh skeleton imports.
- Profile disposition is preserved in the bank-settings pull route.

## Verification

| Gate | Result |
|---|---|
| UI production build (`npm run build` in `ui/`) | ✅ pass |
| UI typecheck (`npx tsc --noEmit` in `ui/`) | ✅ pass |
| Server unit tests in isolation (`node --test --test-force-exit` per file) | ✅ pass |
| Full globbed server test run | ⚠️ pre-existing flakiness from shared `database/architxt.db`; not a release blocker |
| Docs build (`npm run build` in `architxt-docs/`) | ✅ pass |

## Migration Notes

- No database migrations are required.
- **Action required:** Clean and re-sync the local context graph for each bank after upgrading (see warning above).

## Full Changelog

See [CHANGELOG.md](./CHANGELOG.md).
