### Entity id format

- Known entities use the canonical id `TYPE:ENTITY-ID` (for example, `example-type:EXAMPLE-001`). The exact prefix and id are supplied in the entity catalog.
- Discovered entities use `found:{slug}` where the slug is a lowercase hyphenated identifier derived from the entity name.
- The `name` field of a node is the human-readable display name and must not include the id.
