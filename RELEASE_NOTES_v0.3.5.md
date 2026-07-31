# architxt v0.3.5

## Highlights

v0.3.5 is a major Research/Explore release focused on a **canonical graph pipeline**, **prompt/graph standardization**, and **Hindsight integration reliability**.

- **Universal graph format** — all Research and Explore graphs now use one canonical node/edge shape, with styling derived locally instead of leaking presentation fields across the API.
- **Template-driven Research queries** — Reflect/Synthesize now use explicit prompt templates (`narrative`, `graph-known`, `graph-discovery`, `graph-discovered-only`, `narrative-graph-*`) instead of separate output-mode and discovery toggles.
- **Models query mode** — fetch and merge selected Hindsight mental models into the Research canvas.
- **Derived mental-model health + batch refresh** — inspect composed prompts, parse errors, and refresh all derived models at once.
- **Hindsight polling robustness** — paginate past the 100-operation and 1000-mental-model caps, align server timeouts with the 15-minute UI proxy.

## New features

### Research

- Replace Reflect/Synthesize discovery toggle with an explicit prompt-template selector.
- Add Models query mode: fetch, parse, and merge selected mental-model graphs.
- Add graph-only output modes for Reflect and Synthesize.
- Show query type and narrative/graph badges in trail rows.
- Move trail provenance action from double-click to a dropdown menu.
- Show the source steps that will be sent to synthesis when in Synthesize mode.
- Add Query inspector dialog with a Provenance tab.

### Explore

- Import Research step graphs ad-hoc onto the canvas.
- Add reset-canvas button with confirmation.
- Reuse shared `useResearchGraph` for Import-from-Research preview.
- Canonicalize toolbox entities from the Hindsight graph and paginated entity list.

### Mental models / Hindsight

- Add composed-query preview for derived mental models.
- Add derived mental-model health dialog with narrative chars, node/edge counts, parse errors, and resizable response panel.
- Add Refresh All action with confirmation.
- Batch derived mental-model override saves.
- Compare mental models using their composed queries.

## Improvements

### Graph pipeline

- Canonical graph end-to-end: one portable `GraphNode`/`GraphEdge` shape across server and UI.
- Strip non-canonical fields (`category`, `mention_count`, `edge_source`, `relationship_type`, etc.) from API responses; derive them locally in Cytoscape helpers.
- Centralize graph normalization, ID canonicalization, and endpoint synthesis in `ui/app/research/graph-utils.ts`.
- Unify all graph extraction on `parseGraphResponse`; empty `{ nodes: [], edges: [] }` is now a valid graph.
- Enforce the graph contract server-side: missing known edge endpoints are completed from the catalog, discovered-only templates drop known-known edges, and standalone known nodes are removed.

### Prompts

- v0.3.5 prompt/graph redesign: schema, seeds, fragments, and `template-service.js`.
- Modular prompt fragments: `output-format-graph.md`, `node-discovery-policy-*.md`, `provenance-rules.md`, `entity-catalog.md`, etc.
- Strengthen discovery prompts with connected-node rule, canonical-id reuse rule, and explicit discovery instructions.
- Fix corrupted/duplicate discovered-only seed templates.

### Reliability / performance

- Hindsight poll daemon paginates active operations and mental-model lists past API caps.
- Align research Hindsight calls and server `requestTimeout`/`headersTimeout` with the 15-minute UI dry-run proxy.
- Batch compose mental-model diff prompts.
- Batch derived mental-model override saves.
- Page Hindsight entity list by empty-page/duplicate-id instead of trusting `body.total`.

### UI polish

- Match Research Global entity display with Explore.
- Colour Explore edge rows by relationship type like Research.
- Fix autocomplete and prompt double-prefixing of qualified entity IDs.
- Confirm-close dry-run dialog while extraction is running.
- Reset active session and trail correctly when the bank changes.

## Fixes

- Synthesize/Reflect discovered-only graphs now synthesize missing known endpoint nodes instead of rendering empty.
- Reflect stores selected template directly and drops legacy `output_mode`/`allow_discovery` fields.
- Explore toolbox uses the correct node-label source priority so imported nodes keep their research labels.
- Derived mental-model health status is derived from parse errors, not a fallback graph object.
- `ensure-schema.js` patches built-in prompt templates on startup even when none are missing.
- Correctly parse the first balanced JSON block after `## ARCHITXT-GRAPH-DATA` and ignore trailing narrative.

## Operations / configuration

- `ARCHITXT_RESEARCH_SYNTHESIZE_TEMPLATE` added to `.env.example` with default `narrative-graph-known`.
- Document-denoise boolean flags in `.env.example` aligned with `config.js` parsing (`true` instead of `1`).
- Version bumped to `0.3.5` across root, server, UI, and `@architxt/entity-matcher`.

## Migration notes

- Existing Research sessions that used `output_mode` / `allowDiscovery` will fall back to the default template. No silent reconstruction of legacy fields.
- Existing databases will receive the new built-in prompt templates automatically via `ensure-schema.js`.
- The canonical graph change removes some non-portable fields from API responses; UI consumers must now derive styling from `node.type` and `edge.source`.

---

Full diff: `v0.3.4...v0.3.5` (104 files changed, ~7K insertions).
