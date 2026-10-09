# Release Notes — architxt v0.4.4

**Branch:** `feat/v044`  
**Tag target commit:** TBD after merge  
**Release date:** 2026-10-10

## Highlights

- Refreshed documentation landing page with an IT-architecture tagline and a screenshot carousel.
- Persistent retain dry-run runs across the UI and backend.
- Default model and timeout configuration aligned with the current Ollama Cloud deployment.

## New Features

- **Docs landing page**
  - Browser title set to exactly **"architxt: unlock the doc"**.
  - Hero copy: *"Designs → Contextual Graph → Knowledge"* and *"architxt is an IT architecture focused knowledge workbench..."*.
  - Carousel with three screenshots in order:
    1. Import documents and consistently tag entities
    2. Investigate and curate solution design artifacts
    3. Construct grounded views for use in your designs
- **Retain dry-run runs**
  - Save, load, rename, and delete retain dry-run runs.
  - Export results as markdown with a run label.
  - Compact single-line toolbar with running-man icon and suffix input.
  - Reset button restores bank defaults without clearing the panel.

## Changed

- `server/src/config.js` defaults updated:
  | Variable | Old | New |
  |---|---|---|
  | `ARCHITXT_DENOISE_LLM_MODEL` | `gpt-oss:20b-cloud` | `gpt-oss:120b-cloud` |
  | `ARCHITXT_DENOISE_LLM_TIMEOUT_MS` | `600000` | `1200000` |
  | `ARCHITXT_DENOISE_LLM_TEMPERATURE` | `0.1` | `0.0` |
  | `ARCHITXT_DIAGRAM_BATCH_SIZE` | `2` | `1` |
  | `ARCHITXT_CONTEXTUAL_GRAPH_SYNC_DAEMON_ENABLED` | `false` | `true` |
- Workspace packages bumped to `0.4.4` and internal `@architxt/*` dependencies aligned.

## Fixed

- Retain runs route correctly mounted and returns a plain array.
- Single retain run fetch unwrapped from `dbExec` wrapper.
- Extraction reset re-derives bank defaults instead of blanking the form.
- Base UI select issues avoided by using `null` for unselected run values.

## Verification

| Gate | Result |
|---|---|
| UI typecheck (`npx tsc --noEmit` in `ui/`) | ✅ pass |
| UI production build (`npm run build` in `ui/`) | ✅ pass |
| Server unit tests (`npm run test` in `server/`) | ✅ 400/400 pass |
| Server syntax check (`node --check src/config.js`) | ✅ pass |
| Docs build (`npm run build` in `architxt-docs/`) | ✅ pass, no warnings |
| Root package-lock valid JSON | ✅ pass |
| Docs package-lock valid JSON | ✅ pass |

## Known Issues

- UI ESLint reports a large volume of pre-existing `no-explicit-any` and `react-hooks/set-state-in-effect` errors. These are not introduced by this release and do not block the build.

## Migration Notes

- No database migrations are required for this release.
- Operators relying on the previous denoise defaults should review the new timeout and model values if running against a local or different model endpoint.

## Full Changelog

See [CHANGELOG.md](./CHANGELOG.md).
