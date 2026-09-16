# architxt v0.3.8 — feat/v38 merge

This release brings the work from the `feat/v38` branch to `main`.

## Highlights

### Hindsight bank settings sync
- Add a dedicated **Bank Settings** page for editing Architxt master defaults.
- Sync bank settings to/from a Hindsight bank, including missions and disposition traits.
- Add a compare modal showing local Architxt values against live Hindsight values.
- Read Hindsight disposition from the correct `/config` shape; no longer uses the removed `/profile` endpoint.
- Treat unset Hindsight disposition traits as the neutral default `3` instead of falling back to Architxt defaults.

### Contextual graph / mental models
- Add section-name anchors to system contextual-graph template source queries for stable per-section generation.
- Stop persisting summary/capabilities on node-scoped models.
- Require and preserve evidence on graph edges and enforce evidence arrays on narrative/diagram/table envelope elements.
- Strip inline citations from narrative prose before evidence validation.
- Allow bulk config updates on system templates (same mutable fields as the single-item route).

### Workspace UI polish
- Persist workspace controls and sidebar width across page switches.
- Make research session item titles editable.
- Add click-to-expand on session item body and show the full query in expanded items.
- Consolidate mental-model modal validation into a top banner.
- Align toolbar button ordering across Documents, Models, and Workspace pages.
- Move Add Server button to a right icon-only toolbar.

### Evidence panel / modal
- Convert evidence panel into a resizable EvidenceModal matching the focus-modal layout.
- Add source document tree with queried/supporting memory ids, chunk text, and metadata.
- Add per-document **Show in context** toggle that fetches full document chunks.
- Add render toggle for Markdown/plain chunk text and a copy action on chunk panes.

### Diagrams
- Upgrade Mermaid to v12 and switch default layout to ELK.
- Add fit-to-page toggle with corrected panzoom math.
- Use a shared `renderMermaid` helper across all diagram surfaces.

### Models / delete from bank
- Add delete-mental-models-from-bank dialog on the Models page and Contextual Graph manager.
- Remember last server/bank selection in the delete dialog.
- Refresh mental models after push to bank and guard duplicate pending ops.

### Configuration
- Update default LLM model defaults:
  - `ARCHITXT_VISION_MODEL=gemma4:31b-cloud`
  - `ARCHITXT_DENOISE_LLM_MODEL=gpt-oss:20b-cloud`

## Fixes
- Debounce AQL editor change notifications and flush the final value correctly.
- Prevent narrative viewer jitter during reflect polling.
- Fix mental-model modal save/canSubmit guard instrumentation.
- Reverse Context Patches / Mental Models panel resize handle directions to match natural behavior.
- Stop fabricating narrative from source memories in diagram-only reflect output.
- Repair literal `\n` in diagram content and fix JSON unescape misfire.
- Fix inverted queried-memories panel resize direction and evidence modal footer overflow.
- Align evidence modal headers/panels with the standard workspace PanelHeader styling.
- Restore mermaid `suppressErrorRendering` to prevent error banners.

## Known issues

- Server tests: 372/374 pass. Two pre-existing failures remain:
  - `contextual-graph-apply-model-output.test.js:503` — "synthesizes envelope from Markdown capability table" (`1 !== 0`).
  - `entity-info-route.test.js:205` — "returns derived and plain mental models linked to the entity" (`0 !== 1`).
- UI lint: `next build` succeeds, but `npm run lint` reports 641 errors (mostly `no-explicit-any` and React Hook purity rules) plus many warnings. These are accepted for this release.

## Technical

- Version bumped to `0.3.8` across root, server, UI, and internal packages (`@architxt/aql`, `@architxt/entity-matcher`).
- Docker Compose image tag updated to `architxt:0.3.8`.
- Generated `version.json` updated to `0.3.8`.

Full diff: `v0.3.7...v0.3.8`.
