# Release Notes — architxt v0.4.3

## Highlights

- **Views page** — a new, bank-scoped visual surface for exploring and composing the contextual graph. Select entities from the left panel, arrange the canvas, inspect mental-model detail in the right panel, and send the result to a curated Workspace page.

## New features

- Views: three-column layout with resizable entities, canvas, and detail panels.
- Views: per-bank view tabs with create, rename, delete, undo, redo, and timeline actions.
- Views: entity and edge-group selection panel with `All`/`View` filters and search.
- Views: canvas selection, drag, box selection, and delete for authored views.
- Views: detail panel rendering mental-model envelopes for selected nodes and edges.
- Views: floating layout controls for algorithm, direction, routing, spacing, background, labels, IDs, handles, color bars, and top-K node filtering.
- Views: edge merge modes (Full, Type, None).
- Views: auto-layout, reset, timeline snapshots, and export to PNG/SVG/Mermaid.
- Views: send a view’s graph to a Workspace curated page, with merge confirmation when the page already contains a graph.
- Workspace: curated pages now autosave.
- Workspace: chat thread state persists across reloads without auto-opening a thread on initial load.

## Improvements and fixes

- Docker/Docling: updated base image packages, pinned Docling and rapidocr versions, switched to opencv-python-headless, and fixed external Docling host configuration.
- License changed from Apache-2.0 to MIT.

## Technical

- Version bumped to 0.4.3 across root, server, UI, docs, and packages.
- `package-lock.json` reconciled.
- Docusaurus docs build regenerates `static/llms.txt` and `static/llms-full.txt`.

## Migration notes

- No database migration is required.
