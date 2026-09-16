# architxt v0.3.7 — post-v0.3.6 fixes

This release contains fixes and improvements made on `main` after v0.3.6.

## Fixes

- Prevent entity attachment to contextual-graph template-role mental models (server CRUD + route guards + UI toolbar guard).
- Fix guard regression that blocked plain (`template_role: null`) and `user_entity_derived` mental models.
- Surface server error messages in the mental-model entities dialog instead of a generic toast.
- Unified name derivation for contextual-graph model refs: all names now derive from the same template + graph-node substitution path, with no special-casing per role.
- Remove stale scope/role display caches and unify helper usage across workspace panel, manager, and mental-models tab.
- Keep edge-context badge count stable on row click by removing the mental-model content cache fallback.

## Known issues

- Edge-context badge count may still not match the intended number of contextual edges in some banks. This is under investigation and will be addressed in feat/v38.

## Technical

- Version bumped to `0.3.7` across root, server, UI, and internal packages (`@architxt/aql`, `@architxt/entity-matcher`).
- Docker Compose image tag updated to `architxt:0.3.7`.
- Generated `version.json` updated to `0.3.7`.

Full diff: `v0.3.6...v0.3.7`.
