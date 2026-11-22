# Release Notes — architxt v0.5.2

**Release date:** 2026-11-23 · **Branch:** `feat/v052`

## Highlights

### LikeC4 export

The contextual-graph export endpoint and export dialog gained a **LikeC4** format (`format=likec4`, `.likec4` DSL download). Entity types can carry an optional `likec4_shape` mapping (new shape select in the entity type dialogs) that controls each node's shape in the LikeC4 output — `rectangle`, `component`, `storage`, `cylinder`, `browser`, `mobile`, `person`, `queue`, `bucket`, `document`, `agent`. Unmapped types fall back to LikeC4's default shape.

### Repository documents

You can now add a whole **git repository** as a document by URI (remote `https://`/`git@` URL or a local path) instead of uploading a file. gitdiagram-serve (gds) analyzes it into an explanation + Mermaid diagram; the stored document-md starts with a **provenance header** (`> repo @ full commit SHA · commit date`) and gets the built-in `system-repository` context auto-prepended. The repo URI is stored as the document's full path. gds has no cache, so re-running extraction after pulling the repo refreshes the diagram. gds LLM config is now **service-level only** (`GITDIAGRAM_SERVE_LLM_MODEL`, default `gpt-4o-mini`) — per-document overrides were removed; the UI shows gds defaults as placeholders.

### System tags

Every newly created document is automatically stamped with a source-type system tag: `ARCHITXT-DOC`, `ARCHITXT-TRACE`, or `ARCHITXT-REPO` (`generated_by=system`). System tags are read-only (rename/delete rejected with 403), following the system-metadata pattern; you can still add/remove the tag association on individual documents. Forward-only: existing documents are not backfilled.

### Trace sequence graph output

`sequenceProfile` gained `outputFormat: "steps" | "graph"`. The `graph` mode skips signatures and works from raw ordered rows: every consecutive step pair becomes an observed flow, deduped and split into **connected components**, each rendered as its own `## Graph N` section with a Nodes table and an Edges table (**From | To | Type | Label | Support** plus one column per token field). Section headings are **unnumbered by default** (ordinals carry no signal); `includeSequenceNumbers: true` opts back in. The old `includeTransitions` option was removed. Token columns in trace views are now orderable.

### Deployment

- compose builds gds from the **public GitHub release tag** `gitdiagram-serve.git#v0.2.0` (no local checkout required)
- hindsight image bumped to `ghcr.io/vectorize-io/hindsight:1.2.3`

### Fixes

- Graph export downloads made reliable (plus export debug logging); LikeC4 export routed through the raw-text download path
- Upload dialog: fixed stale-closure guard on `repoUri`; removed client-side repo URI validation (the server is the single authority); repository upload button labeled "Upload"

## Verification

- Server: 761/761 tests pass, eslint 0 errors
- UI: `tsc --noEmit` clean, production build succeeds
- Docs: production build succeeds, `llms-full.txt` regenerated
- Compose: `podman compose config` valid; gds tag `v0.2.0` and hindsight `1.2.3` confirmed present on their registries
