# Handoff: graph canonicalization / strip-and-align work (2026-07-22)

## Branch / repo state
- Repository: `/home/richard/architxt`
- Branch: `feat/v035`
- Latest pushed commit: `ec9d9fd` — `refactor(graph): strip non-canonical enrichment fields from server and UI`
- Working tree: clean (all changes pushed)

## Goal
Collapse the UI/server graph data model to a single, portable canonical node/edge vocabulary. No more per-query-mode shape differences or fallback aliases. Only canonical fields are emitted/typed:

- **Node:** `id`, `name`/`label`, `type`, `source`, `provenance`
- **Edge:** `id`, `from`, `to`, `type`, `label`, `detail`, `weight`, `provenance`

## What was completed today

### 1. Rendering fix for discovered-only sample graph (commit `902e71b`)
- File: `ui/app/research/graph-utils.ts`
- Added `displayNodeType()` so discovered `found:*` nodes get `type: "found"` and do not get hidden by empty auto-seeded filters.

### 2. Single canonical UI graph types (commit `9d0ddb2`)
- `ui/lib/api/client.ts`: made `GraphNode`, `GraphEdge`, `GraphCanvas` the single source of truth.
- `ui/components/research-canvas.tsx`: removed local duplicate interfaces; now imports/re-exports from `client.ts`.
- Added optional render fields (`x`, `y`, `width`, `height`, `color`) to `GraphNode`.
- Dropped unused `confidence` field.

### 3. Server emitters aligned to canonical shape (commits `9d0ddb2`, `c59ca7b`, `ec9d9fd`)
- `server/src/services/research/halo-graph.js`: hindsight graph now emits edges as `{ id, from, to, type, label, weight }`; removed `category`, `hindsight_id`, `mention_count`, `edge_source` from nodes; `computeProminence` now derives from graph degree.
- `server/src/services/research/mental-model-edges.js`: removed `edge_source: 'mental_model'` injection.
- `server/src/prompts/graph-parser.js`: removed `edge_source` injection from mental-model edges; still preserves `label` and `provenance` on nodes.
- `server/src/services/research/handlers/reflect.js`: maps legacy `output_mode`/`allow_discovery` to v0.3.5 template names; tags source-less parsed nodes with `source: 'mental_model'`.
- `server/src/services/research/handlers/synthesize.js`: legacy option mapping, fixed known-only filter, discovery templates keep all normalized nodes/edges, discovered-only enforces endpoint rule; comment updated to state no legacy aliases are emitted.
- `server/src/services/research/mental-model-discovery.js`: edge dedup key uses `from`/`to`.

### 4. UI Cytoscape / canvas layer aligned (commit `ec9d9fd`)
- `ui/lib/graph/cytoscape-elements.ts`: removed `relationship_type` alias; derives `category` via `mapTypeName(type)`; maps `edge_source` from canonical `e.source`.
- `ui/components/research-canvas.tsx`: selectors and edge detail now use `type` and `e.source` instead of `relationship_type`/`edge_source`.
- `ui/components/component-diagram.tsx`: updated selectors to use `type` / `e.source`.
- `ui/app/research/graph-utils.ts`: removed `edge_source`, `mention_count`, `depth`, `prominence` injection.
- `ui/app/research/use-research-graph.ts`: removed `mention_count`, `depth` handling; prominence computed locally from degree.
- `ui/app/research/edge-table.tsx`: replaced `edge_source === 'synthesize'` with `provenance === 'inferred'`.
- `ui/app/research/research-result-panel.tsx`: updated hover display to use canonical `source`/`provenance`.

## Verification status
- `cd /home/richard/architxt/server && npm test` — **passed** 72/72
- `cd /home/richard/architxt/ui && npx tsc --noEmit` — **passed**
- `cd /home/richard/architxt/server && npm run lint` — **blocked** (pre-existing: ESLint v9.39.4 cannot find `eslint.config.*`)

## Known runtime issue still open
A new error was reported but not yet diagnosed:

```
edgeIdx is not defined
lib/api/client.ts (59:11) @ fetchApi
  57 |
  58 |   if (!response.ok) {
> 59 |     throw new ApiError(
     |           ^
  60 |     data?.error || `Request failed: ${response.statusText}`,
  61 |     response.status,
  62 |     data?.code || 'UNKNOWN_ERROR'
```

The visible stack points to `fetchApi` throwing because the response was not OK. `edgeIdx is not defined` is likely the actual underlying error returned by the server, or it is a reference in code that calls `fetchApi`. **Need to find the `edgeIdx` reference and fix it.** Search starting points:
- `grep -R "edgeIdx" server/src ui/lib ui/app ui/components`
- Also check `server/src/services/research/entity-seed.js` (touched today; it still has a `mapTypeName` helper that may be connected to indexing logic).
- The stack frame at `client.ts:59` is the throw site, not the `edgeIdx` definition site.

## Remaining work for next session
1. **Diagnose and fix `edgeIdx is not defined`.** This is the active bug reported by the user.
2. **Finish the legacy-alias audit.** Search repo-wide for:
   - `edge.source`, `edge.target` (any remaining runtime reads)
   - `relationship_type`, `link_type`
   - `hindsight_id`, `mention_count`, `depth`, `edge_source`, `category` in server emitters
   Strip any remaining runtime fallbacks; keep only canonical fields in the server response.
3. **Add a targeted UI/integration test** for the discovered-only end-to-end graph shape.
4. **Database seed cleanup:**
   - Re-seed or migrate any DB that loaded corrupted prompt rows.
   - Remove unused `prompt_templates.pt_discovery_allowed` column via schema migration + re-seed.
5. **Server lint config:** decide whether to create `eslint.config.js` or defer (currently blocking `npm run lint`).

## Design decisions to preserve
- The canonical graph shape is the **only** shape emitted by handlers. Legacy `source`/`target`/`relationship_type`/`link_type` aliases are stripped, not preserved as fallbacks.
- Only the prompt policy varies by template/mode: `known-only`, `discovery`, `discovered-only`. The node/edge contract stays identical.
- UI computes styling metadata (colors, prominence, edge-origin labels) locally from canonical fields (`type`, `provenance`, `source`).
- `normalizeGraph` takes `mode` (resolved template name) and derives discovery/discovered-only policy internally; the old `discoveryAllowed` boolean is gone.
- `depth` and `prominence` are UI-local concepts, not server fields.
- `pt_discovery_allowed` remains in DB schema for `ensure-schema.js` seed compatibility but is no longer read by research handlers.

## Commits on `feat/v035` (newest first)
- `ec9d9fd` — refactor(graph): strip non-canonical enrichment fields from server and UI
- `c59ca7b` — cleanup synthesize.js comment around legacy aliases
- `9d0ddb2` — refactor(graph): single canonical GraphNode/GraphEdge across UI and server
- `902e71b` — fix(graph): ensure discovered-only nodes carry type "found" for filters

## Relevant reference docs
- `references/architxt-graph-parser-consolidation-2026-07-22.md`
- `references/architxt-discovered-only-known-endpoint-node-contract-2026-07-22.md`
- `references/architxt-prompt-graph-standardization-v035-design-pattern.md`
- `references/architxt-prompt-graph-v035-stage2-parser-normalizer-pattern.md`
- `references/research-discovered-only-graph-node-synthesis.md`
- `references/explore-discovered-only-graph-synthesis.md`
- `references/explore-discovered-only-graph-reuse.md`
