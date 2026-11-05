# Release Notes — architxt v0.5.0

**Branch:** `feat/050`  
**Tag target commit:** TBD after merge  
**Release date:** 2026-11-05

## Highlights

- New `openai_responses` LLM provider, including configurable reasoning effort.
- Per-document processing stage overrides let you disable individual extract stages per document.
- Denoise-LLM chunking is safer on flat raw logs with a hard cap, blank-line/sentence fallback split, and isolation of over-long lines.
- Research and workspace reliability fixes for `pending_operations` lifecycle and Reflect step reuse.

## New Features

- **OpenAI Responses provider**
  - New `openai_responses` LLM provider.
  - `ARCHITXT_OPENAI_RESPONSES_URL`, `ARCHITXT_OPENAI_RESPONSES_API_KEY`, `ARCHITXT_OPENAI_RESPONSES_DEFAULT_MODEL`, `ARCHITXT_OPENAI_RESPONSES_TIMEOUT_MS`, and `ARCHITXT_OPENAI_RESPONSES_REASONING_EFFORT` env vars.
  - Documented in architxt-docs configuration page.
- **Per-document processing stage overrides**
  - Toggle individual extract pipeline stages on/off per document from the document edit modal.
  - Disabled stages are shown in the documents list.
  - Saved overrides ignore globally disabled stages.
  - UI sends complete processing options on edit to avoid losing prior overrides.
  - Documented in architxt-docs.
- **Documentation site SEO**
  - Added `robots.txt` with sitemap reference.

## Changed

- Denoise-LLM chunking now bounds flat raw-log growth with a hard character cap (1.5x chunk size), blank-line/sentence fallback split, a max 200-line safety valve, and isolation of over-long single lines.
- Processing-options toggles are gated on global env config, and disabled stages are ignored when saved overrides are persisted.
- Processing options moved into the "Tags, Context & Metadata" section of the document edit dialog.
- API document shape for processing options aligned with the pipeline runner.

## Fixed

- Denoise-LLM isolates over-long lines instead of merging them into surrounding chunks.
- Workspace Reflect step restores saved options when reused.
- Research synchronous runner lifecycle is now mirrored correctly into `pending_operations`.
- Real call durations are now recorded in reflect and recall handlers.

## Verification

| Gate | Result |
|---|---|
| Server tests (`npm run test` in `server/`) | ✅ pass — 538 tests, 0 failures |
| UI typecheck (`npx tsc --noEmit` in `ui/`) | ✅ pass |
| UI production build (`npm run build` in `ui/`) | ✅ pass |
| architxt-docs build (`npm run build`) | ✅ pass |
| Docker compose config | ✅ valid |

## Migration Notes

- No database migrations are required.
- Review `server/.env.example` for the new `ARCHITXT_OPENAI_RESPONSES_*` settings and ensure any global processing stage disables are reflected in existing per-document overrides.

## Full Changelog

See [CHANGELOG.md](./CHANGELOG.md).
