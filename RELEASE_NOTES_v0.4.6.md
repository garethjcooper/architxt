# Release Notes — architxt v0.4.6

**Branch:** `feat/v046`  
**Tag target commit:** TBD after merge  
**Release date:** 2026-10-20

> ⚠️ **Important:** After upgrading, open **Settings → Server → Banks** and click **Clean local graph** for each bank, then run **Sync local graph** again. This ensures your local context graph is rebuilt cleanly with the corrected edge-detail hashing and entity ID canonicalisation introduced in this release.

## Highlights

- Views page **Save to workspace** now exports to **Flowchart**, **Graph**, or **Table** formats from a single picker.
- Canonical graph handling is more stable: directed edge IDs now include edge `detail`.
- New **Clean local graph** action in the server banks dialog for explicit graph reset.

## New Features

- **Save to workspace — multiple formats**
  - The existing **Send to** modal now shows three toggles: **Flowchart**, **Graph**, and **Table**.
  - **Flowchart** is selected by default; at least one format must be selected.
  - Multiple selected formats are merged into the same target page envelope.
  - Events are regenerated from the current picker selection at apply time, so toggling formats always matches the saved output.
- **Graph export**
  - Produces a canonical `type: 'graph'` envelope from the active view.
- **Table export**
  - Produces node and edge tables using the same row/column structure as the Graph focus modal's **Add table to page** action.
- **Clean local graph**
  - Available in **Settings → Server → Banks** to wipe stale contextual graph data before re-syncing.

## Changed

- Directed edge ID hash now includes edge `detail`, so graph identity remains consistent when detail changes.
- Views graph and Mermaid exports now use canonical entity IDs consistently.

## Fixed

- Export events no longer use a stale, pre-generated snapshot when formats are toggled inside the picker.

## Verification

| Gate | Result |
|---|---|
| UI production build (`npm run build` in `ui/`) | ✅ pass |
| Server unit tests (`npm run test` in `server/`) | ✅ 440/440 pass |
| Docs build (`npm run build` in `architxt-docs/`) | ✅ pass |

## Migration Notes

- No database migrations are required.
- **Action required:** Clean and re-sync the local context graph for each bank after upgrading (see warning above).

## Full Changelog

See [CHANGELOG.md](./CHANGELOG.md).
