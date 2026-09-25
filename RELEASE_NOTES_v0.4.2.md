# architxt v0.4.2 — Workspace Chat and contextual graph polish

This release introduces **Workspace Chat**, a focused agent Q&A column alongside Reflect and curated pages, and polishes the contextual graph manager and Workspace envelope rendering.

## Highlights

### Workspace Chat

- **Third Workspace column** — a new **Chat** panel sits to the right of curated pages. It is scoped to the active research session and supports multiple isolated threads.
- **Natural-language questions** — ask the architxt agent about entities in the active Hindsight bank. Entity and edge references are auto-completed with `[[` and AQL block references with `##`.
- **Recall + synthesis pipeline** — the agent resolves entity references, recalls grounded memories, synthesizes an IT-architect-style answer, and merges edge-context graphs.
- **Unified envelope replies** — chat responses render as narrative + graph + contextual-items envelopes using the same envelope viewer as Reflect and previews.
- **Add to page** — copy any envelope section from a chat reply directly into an open curated page.
- **Threaded conversations** — create, rename, delete, and switch threads inside a session; threads persist across reloads.
- **Configuration** — chat uses its own provider/model/temperature settings under `ARCHITXT_AGENT_*` env vars, including configurable intent-classifier token limits for reasoning models.

### Workspace improvements

- **Toggles for data and chat columns** — show or hide the left contextual-data column and right chat column from the Workspace control bar.
- **Collapsible agent response cards** — long agent replies start collapsed and expand on demand; both states scroll cleanly.
- **Chat contextual-data card** — compact contextual-items list below each agent reply, with ALL / NODES / EDGES filter and multi-word AND search.
- **Panel counters standardised** — counters now consistently show total (in scope).
- **Better chat input** — taller input, matching Reflect font style, and Alt+Enter / Shift+Enter for a new line.
- **No slash commands** — chat now relies on natural language and entity detection rather than `/revise` or `/find`.

### Envelope and AQL

- **One graph block per query** — AQL now rejects multiple `#graph` blocks in a single query, matching how the Workspace renders sections.
- **Blank-line section separation** — Markdown rendering inserts blank lines between envelope sections so headings and prose do not run together.
- **AQL syntax errors surfaced** — Reflect Run flow shows AQL parser errors directly.
- **Mermaid label quoting hardened** — prompts guard arrow and message labels that contain parentheses, brackets, or braces.
- **Per-section focus cardinality** — workspace prompts enforce one section per focus type to avoid cross-type duplication.

### Contextual graph manager

- **Mental-model filters** — All / Empty / Failed filters plus search, matching the graph/candidates tab experience.
- **Mental-model search aligned** — input width and styling now match the other manager tabs.
- **Empty-envelope refresh state** — mental models that refreshed successfully but returned an empty envelope show an amber OK state.
- **Evidence modal defaults** — source documents start collapsed; chunk text loads when a chunk or document is selected.
- **Entity-info batching** — chat contextual-data requests stay within the 100-id API limit; results are cached and deduped.

### Performance and reliability

- **Deduped evidence fetches** — document metadata and chunk text are fetched once and shared across UI components.
- **Memoized chat messages** and virtualized contextual-item lists keep the chat column responsive.
- **Throttled panel resize** and LRU-cached entity-info results reduce re-renders.
- **Polling storm fixes** — session-list polling loops deduplicated and Hindsight operation polling tightened.

## Documentation

- New [Chat](../workspace/chat) documentation page covering threads, sending messages, reading agent responses, and contextual data.
- Workspace focus and preview pages updated to describe chat-to-curated-page flows and envelope controls.
- Configuration page expanded with the `ARCHITXT_AGENT_*` chat settings.
- AQL page now documents the single-graph-block limit.
- All generated examples use placeholder values instead of real system names.
- Generated `llms.txt` / `llms-full.txt` refreshed.

## Technical

- Version bumped to `0.4.2` across root, server, UI, and internal packages (`@architxt/aql`, `@architxt/entity-matcher`).
- New `agent_chat_threads` and `agent_chat_messages` tables.
- New `/api/v1/sessions/:id/chat/*` endpoints.
- Docker Compose image tag updated to `architxt:0.4.2` (compose file already at `0.4.2`).
- Generated `version.json` updated to `0.4.2`.

## Known issues

- UI lint: existing warnings from prior releases remain (`next build` succeeds and is the release gate).

Full diff: `v0.4.1...v0.4.2`.
