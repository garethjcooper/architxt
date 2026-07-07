# Architxt v0.3.3 — Release Notes

## Mental Models & Derived Instance Health
- Added a health-check panel for derived mental-model instances so users can see why a model failed or what content was parsed.
- Display parsed content and error details (including the raw returned text and a diagnostic snippet) in the health dialog.
- Added a character-count column and header badge so it’s easy to spot unexpectedly short or long parsed content.
- Refresh derived instances directly from the model page; refresh status is tracked with a sky-blue processing badge and auto-rechecks when complete.
- Search and select-all in the Derived Instances panel now respect the current filter.

## Explore Canvas & Toolbox
- New draggable data toolbox with **Entities** and **Edges** tabs: search, dim non-matches, click to add/remove from the canvas, and hover for previews.
- Taller preview pane showing grouped inbound/outbound edge labels and summaries, with “Not loaded” / “No summary available” states.
- Clicking an entity or edge row in the left card now selects the corresponding canvas node/edge and opens the toolbox.
- Prebuilt dimension badges now show three states: green (with data), orange (loaded but no data), red (error).
- Graph controls derive node type from ID prefix when the explicit type is missing, so all canvas types appear in the type filter.
- Added Controls pop-out on Entity Summaries and Edges cards with **Copy text** and **Save .md**.

## Entity Types & Entity Management
- Added **Entity ID pattern** support: define a prefix, separator (`None` / `-`), and digit count; entity types and individual entities display a conformity badge and a **Next ID** helper.
- Related documents modal for entity types, powered by FTS5, with filename column and direct link into entity detection.
- Highlight case/boundary badges that differ from the entity type default; tooltips now clearly label them as entity overrides.
- Batch **Config** action for entity type, case match, and word-boundary match.
- Case/boundary inheritance normalized on startup; null overrides let entities inherit type defaults.
- Entity detection dialog redesigned: tabbed **Existing** / **Found** sidebar, A-Z sorting, search filter, richer purple/violet highlights, and better context row layout.
- Fixed scanner offset math, malformed-tag tolerance, and prevented existing tags from being re-found.
- Fixed a regression where clicking an entity-type row no longer opened the view/edit modal.
- Fixed hooks-order and document-transform issues in entity routes.

## Research & Hindsight
- `word_boundary_match` is now exposed and respected at entity and entity-type level across research seeding.
- Recall/Reflect Budget dropdown styling aligned with the Explore graph-controls layout.
- Hindsight server/bank selection is now persisted across pages.
- Detected badge on the Sync page only appears when entity tags were actually inserted.

## Documents
- New batch **Config** action for setting Date and External ID across documents.
- Removed External ID from the individual config dialog for now; switched to a single batch UPDATE for timestamp configuration.

## Server & Migrations
- Fixed a broken `apiKey` reference in `server/src/services/hindsight/config.js`.
- Made `ALTER TABLE … ADD COLUMN` migrations safe for older SQLite runtimes: duplicate-column errors are ignored instead of relying on `IF NOT EXISTS` syntax that older SQLite rejects.
- Added missing environment variables to `server/.env.example`.

## Package Versioning
- Bumped all workspace packages and the local `@architxt/entity-matcher` dependency to **0.3.3**.

## Notable Bug Fixes

| Area | Fix |
|------|-----|
| **Migrations / SQLite** | Fixed startup crash on existing 0.3.0 clones: `ALTER TABLE … ADD COLUMN` migrations no longer use `IF NOT EXISTS`, which older SQLite rejects. Duplicate-column errors are now caught and ignored instead. |
| **Entity Types UI** | Restored the missing `ViewEntityTypeDialog` render so clicking an entity-type row opens the view/edit modal again. |
| **Server Config** | Corrected the invalid `apiKey` reference in `server/src/services/hindsight/config.js`. |
| **Entity Scanning** | Fixed raw/clean offset mapping, malformed-tag handling, and prevented existing entity tags from being re-detected during a scan. |
| **Research Seeding** | `word_boundary_match` is now passed through and respected when seeding entities in research. |
| **Graph/Canvas** | Empty `nodes`/`edges` JSON no longer treated as an error; missing node types derived from ID prefix so all canvas types show in filters. |
| **Documents** | Timestamp config now uses a single batch UPDATE instead of per-document updates. |
| **Derived Health** | Refresh button disabled while in progress; health rechecks automatically when refresh completes; terminal refresh operations now trigger re-check. |
