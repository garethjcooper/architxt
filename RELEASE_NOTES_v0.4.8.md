# Release Notes — architxt v0.4.8

**Branch:** `feat/v048`  
**Tag target commit:** TBD after merge  
**Release date:** 2026-10-29

> ⚠️ **Important:** After upgrading, open **Settings → Server → Banks** and click **Clean local graph** for each bank, then run **Sync local graph** again. This ensures your local context graph is rebuilt cleanly with the new edge types and export metadata introduced in this release.

## Highlights

- Contextual graph can now be exported in eight formats: JSON, GraphML, GEXF, Cypher, CSV, C4 Structurizr DSL, C4 Mermaid, and ArchiMate Open Exchange Format.
- C4 PlantUML export is replaced by C4 Structurizr DSL.
- Persistent edge types with full CRUD UI and seeded standard edge types.
- C4 and ArchiMate mappings are now stored in the database and used by exporters.
- Bank graph cleanup, mental-model actions, and per-bank sync/import/deployment controls.
- New user-facing documentation including a Use cases page, Servers getting-started guide, bank graph settings, and C4/ArchiMate mapping reference.

## New Features

- **Contextual graph exports**
  - Export button and modal on the contextual graph.
  - Formats: JSON, GraphML 1.0, GEXF 1.3, Cypher, CSV (nodes + edges), C4 Structurizr DSL, C4 Mermaid, ArchiMate Open Exchange Format 3.1.
  - API filtering and coherent-subgraph trimming.
- **Edge types**
  - Persistent edge types stored in the database.
  - CRUD UI for managing custom edge types.
  - Seeded standard edge types on startup.
- **C4 / ArchiMate mappings**
  - Mapping reference data stored in the database.
  - Exporters read C4 and ArchiMate mappings from the architecture metadata resolver.
  - Container view drill-down for synthetic C4 systems.
- **Bank graph controls**
  - Clean local graph and clear local graph actions.
  - Per-bank sync, import, and deployment controls.
  - Mental-model cleanup actions.
- **Documentation**
  - New top-level **Use cases** page with positioning diagram and four first-class use cases.
  - New **Servers** getting-started page.
  - New **Bank graph settings** context-patch page.
  - New **Edge Types** and **C4 / ArchiMate mapping reference** core-concept pages.
  - Updated **Views → Export** and **Contextual graph → Export** documentation.

## Changed

- C4 PlantUML export replaced by C4 Structurizr DSL.
- `sys_edge_context` export metadata enriched for downstream consumers.
- Edge IDs are now counter-based and fast, replacing CPU-heavy hashing in ArchiMate XML export.
- Parallel C4 relationships are collapsed for valid Structurizr DSL.
- Undirected edges now emit paired `->` arrows instead of `<->` in C4 Mermaid output.
- Introduction page now links to **Use cases** alongside **Why architxt?**.

## Fixed

- ArchiMate XML export uses stable, fast IDs.
- Structurizr DSL emits valid braced nesting.
- C4 Mermaid output uses correct directed arrows.

## Verification

| Gate | Result |
|---|---|
| UI production build (`npm run build` in `ui/`) | ✅ pass |
| Server tests (`npm test` in `server/`) | ✅ pass (501/0) |
| Docs build (`npm run build` in `architxt-docs/`) | ✅ pass |

## Migration Notes

- No database migrations are required.
- **Action required:** Clean and re-sync the local context graph for each bank after upgrading (see warning above).

## Full Changelog

See [CHANGELOG.md](./CHANGELOG.md).
