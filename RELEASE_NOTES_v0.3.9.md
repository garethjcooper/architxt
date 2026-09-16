# architxt v0.3.9 — restore v0.3.8 and fix Reflect query input stability

This release restores the v0.3.8 feature set that was accidentally lost when commit `ff2e13cc` reverted the `feat/docv1` squash merge `9225f379`, and adds a targeted workspace UI fix.

## Highlights

- **Restored v0.3.8 code** by merging `feat/v38` into `feat/v039`.
  - The revert removed both the docs merge *and* 109 application files from v0.3.8; this release brings back all v0.3.8 functionality plus the existing post-v0.3.8 documentation site updates.
  - Key restored areas: Bank Settings sync, Contextual Graph / mental-model improvements, Workspace UI polish, Evidence modal upgrades, Mermaid v12/ELK diagrams, and bulk delete-from-bank flows.

- **Workspace Reflect query input fix**
  - Fixed an issue where typed characters could be truncated and the cursor reset to position 0 while typing in the workspace query editor.
  - Root cause: `@uiw/react-codemirror` queues external `value` updates while the user is typing and applies them after a 200 ms pause. Combined with workspace polling re-renders (~1.5–2 s), a stale parent `value` could overwrite the editor document and reset the cursor.
  - Wrapped `AqlEditor` in `React.memo` so parent re-renders that do not change the `value` prop no longer reach CodeMirror.
  - Memoized the `useWorkspaceSession` hook return object so dependent callbacks in `WorkspacePage` stay stable across internal state updates.
  - Combined with the v0.3.8 AqlEditor debounced `onChange` fix, typing now stays responsive and stable during polling.

## Technical

- Version bumped to `0.3.9` across root, server, UI, and internal packages (`@architxt/aql`, `@architxt/entity-matcher`).
- Internal package references updated to `^0.3.9` (server) and `^0.3.9` / `0.3.7` dev-dependency (UI, unchanged from v0.3.8).
- Docker Compose image tag updated to `architxt:0.3.9`.
- Generated `version.json` updated to `0.3.9`.

## Known issues

- Server tests: status unchanged from v0.3.8.
- UI lint: status unchanged from v0.3.8 (`next build` succeeds).

Full diff: `v0.3.8...v0.3.9`.
