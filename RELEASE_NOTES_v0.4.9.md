# Release Notes — architxt v0.4.9

**Branch:** `feat/v049`  
**Tag target commit:** TBD after merge  
**Release date:** TBD

## Highlights

- PowerPoint files can now be preprocessed through Gotenberg before Docling, alongside existing Word and HTML preprocessing.
- Document content panes support Page Up / Page Down keyboard scrolling.
- Denoise LLM chunk size is now configurable, with safer chunk rejoining and a fixed runtime ordering bug.
- Views detail panel now extracts protocol, format, authentication, and encryption into dedicated columns and hides the raw properties JSON.
- More consistent Gotenberg preprocessing with DOC, DOCX, HTML, PPT, and PPTX all supported.

## New Features

- **PowerPoint / Gotenberg preprocessing**
  - `ARCHITXT_CONVERT_PPT_PPTX_TO_PDF` toggle (default `true`).
  - `.ppt` and `.pptx` files are routed through Gotenberg before Docling.
  - Falls back to direct Docling if Gotenberg fails or is unreachable.
  - Documented in `server/.env.example` and architxt-docs.
- **Keyboard page scrolling**
  - Reusable `usePagedScroll` hook.
  - Wired into `ViewDocumentDialog` and `EntityDetectionDialog` content panes.
  - Also enabled in the smart-edit document editor.
- **Configurable denoise-LLM chunk size**
  - New `ARCHITXT_DENOISE_LLM_CHUNK_SIZE` environment variable (default `4000`).
  - Exposed in `/settings`.
  - Chunks are rejoined with single newlines to preserve tables and paragraphs across boundaries.
  - New `chunkMarkdown` tests cover tables, paragraphs, and front matter.
- **JSON graph export of mental-model envelope content**
  - Mental-model envelope content is now embedded in JSON graph exports.

## Changed

- Views detail panel now surfaces protocol, format, authentication, and encryption as columns.
- Raw properties JSON is hidden from the Views detail panel.
- New views no longer receive an automatic default note node.
- CodeMirror editor uses `EditorView.lineWrapping` so selections draw correctly on wrapped lines.
- Docker Compose Docling timeout reverted to the CPU-only default of `1200s`.
- Default Docling container timeout is `240s` for typical workloads, with `DOCLING_SERVE_MAX_SYNC_WAIT` documented.

## Fixed

- Fixed a runtime TDZ error where `denoiseLlmConfig.chunk_size` was referenced before the config object was declared.
- Fixed a conditional hook call in `ViewDocumentDialog` page scrolling.
- Replaced backtracking whitespace regexes in denoise with linear line scans, preventing catastrophic performance on long table lines.
- Extract daemon work-polling contract reverted while keeping `request_release` recovery.
- Documents stuck in `request_release` are now recovered by the reconcile path.

## Verification

| Gate | Result |
|---|---|
| UI production build (`npm run build` in `ui/`) | ✅ pass |
| Server tests (isolated files with `--test-force-exit`) | ✅ pass |
| Docker compose config | ✅ valid |

> Note: the full globbed server test run still exhibits pre-existing shared-DB flakiness. Run related test files individually for a reliable signal.

## Migration Notes

- No database migrations are required.
- Review `server/.env.example` for the new `ARCHITXT_CONVERT_PPT_PPTX_TO_PDF` and `ARCHITXT_DENOISE_LLM_CHUNK_SIZE` defaults.

## Full Changelog

See [CHANGELOG.md](./CHANGELOG.md).
