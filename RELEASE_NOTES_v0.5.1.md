# Release Notes — architxt v0.5.1

**Release date:** 2026-11-19 · **Branch:** `feat/v051`

## Highlights

### Trace profiles: sequence mining & document integration

- Profiles can now define a `sequenceProfile` (order, correlation, token, entity and direction fields, separator, min steps). When present, an extracted trace document stores the **Trace Sequence Analysis** report as its content: a header with the mining parameters, one section per mined sequence (signature, frequency, example trace keys, and a `Step | Entity | Direction | Token` table with Entity/Direction leading), and an optional adjacent-trace transitions table.
- Documents page shows **Type** (Trace vs Document) and **Trace Profile** columns; the document viewer and the bulk config dialog let you set/clear the trace profile on trace documents (with a re-extraction warning), via `PUT /documents/:id` and `/documents/batch/updateconfig`.
- nameMap regrouping fix: moving a value to another group now removes it from the old one.

### Built-in `system-trace` context

- Every trace document automatically gets a fixed `system-trace` context text prepended to any user-selected context (Hindsight push, Hindsight diff/compare, and the documents API). It describes the stored sequence report format and calls out Entity/Direction as the key join columns. It is a code constant — not editable or listed as a regular context.

### Config hygiene

- `.env.example` now covers **all** env vars defined in `server/src/config.js` (adds the trace field-extraction, extract-pipeline, relationship-extraction, and OpenAI Responses blocks; corrects the suggest temperature default to `0.0`).
- Removed dead `ARCHITXT_TRACE_PROFILE_SUGGEST_MAX_ITERATIONS` and the unused `POST /trace-profiles/coverage-loop` route/client/types.

## Verification

- Server: 721/721 tests pass, lint 0 errors
- UI: `tsc --noEmit` clean, production build succeeds
- Docs: production build succeeds, llms.txt regenerated
