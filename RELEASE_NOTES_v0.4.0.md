# architxt v0.4.0 — Workspace curated-page improvements

This release focuses on workspace usability when working with curated pages, graphs, and diagrams.

## Highlights

- **Graph / diagram focus modals default to fit-to-page**
  - Both the graph focus modal and the Mermaid diagram editor now open with fit-to-page enabled, so diagrams no longer render zoomed-in by default.

- **Remove deprecated Mermaid `%%{init: {'layout': 'elk'}}%%` directive**
  - Graph-generated Mermaid flowcharts no longer emit the deprecated `layout` init directive. Renderer selection remains controlled by the global Mermaid initializer.

- **Copy graph evidence when adding diagrams and tables to curated pages**
  - When a graph is added to a curated page as a diagram, the source evidence collected from the graph edges is now attached to the diagram section.
  - The generated node and edge table sections also carry the same graph-level evidence.

- **Add "+ New page" to the add-section target picker**
  - The picker shown when adding a narrative/graph/table/diagram section to a curated page now includes a "+ New page" option at the top.
  - Selecting it creates a new curated page, opens it in a tab, and applies the section immediately.

- **Escape closes the add-section picker**
  - The custom add-section target overlay can now be dismissed with the Escape key.

## Technical

- Version bumped to `0.4.0` across root, server, UI, and internal packages (`@architxt/aql`, `@architxt/entity-matcher`).
- Internal package references updated to `^0.4.0` (server) and `^0.4.0` / `0.4.0` dev-dependency (UI).
- Docker Compose image tag updated to `architxt:0.4.0`.
- Generated `version.json` updated to `0.4.0`.

## Known issues

- Server tests: 3 pre-existing failures unrelated to this release:
  - `applyModelOutput` — "synthesizes envelope from Markdown capability table" (Markdown table synthesis removed in an earlier refactor; test needs removal or feature restoration).
  - `POST /api/v1/entities/info` — derived/plain model count assertion failure.
  - `normalizeModelOutput (contextual envelope)` — narrative assertion does not account for newly-added per-section UUID `id` field.
- UI lint: existing errors/warnings from prior releases (`next build` succeeds and is the release gate).

Full diff: `v0.3.9...v0.4.0`.
