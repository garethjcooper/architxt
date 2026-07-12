# Release Notes — v0.3.4

## Overview

v0.3.4 polishes the Hindsight dry-run extraction experience, continues the database-layer cleanup started in `feat/db-clean`, and fixes a directive sync edge case when a previously synced directive has been deleted from the bank.

## What's New

### Hindsight Dry-Run Extraction

- New **Dry-run Extract** route and UI dialog that previews what Hindsight would extract from a document before committing it to a bank.
- Configurable extraction context, document date, retain mission, entity label source (bank or architxt), free-form entities toggle, and extraction-mode dropdown.
- Results pane uses a 30/70 split with detected entities on the left and extracted facts on the right, including **All / Matched / Unmatched** filters.

### Database Layer Cleanup

- SQLite FTS5 operations are now isolated behind a single full-text search adapter (`server/src/services/search/full-text.js`), reducing future backend-porting cost.
- Hindsight pull/pending-ops/entity sync reads and several tag/directive lookups now route through CRUD helpers instead of inline SQL.

### Deployment

- Added Docker/Podman container support.

## Notable Bug Fixes

| Area | Fix |
|------|-----|
| Hindsight Directives Sync | Fixed "UUID can't be found" error when pushing a directive that was previously synced but later deleted from the bank. Pushes from **Only on architxt** now force-create the directive instead of trying to PATCH the missing bank record. |
| Dry-Run Extraction | Corrected bank entity-label loading from the Hindsight `/config` response and normalized bank list API so `bank_id` is always the bank name. |
| Mental Models | Restored missing `addMentalModelTag` / `removeMentalModelTag` exports used by routes. |

## Known Pre-existing Notes

- UI `npm run lint` warnings are present in the baseline and not introduced by this release branch.
- Next.js static-export warnings about rewrites are expected for the current `output: export` build mode.

## Verification

- `ui/`: `npx tsc --noEmit && npm run build` passed.
- `server/`: `npm test` passed (25 tests, 0 failures).
- `server/.env.example` audited against `server/src/config.js` — no new env vars are missing.

## Internal Version Files

- Bumped root, server, UI, and `@architxt/entity-matcher` workspace versions to `0.3.4`.
- Updated `ui/public/version.json` to the release version and merge-commit SHA.
