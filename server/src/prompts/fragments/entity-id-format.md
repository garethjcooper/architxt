### Entity id format

- Every node already has a stable working-graph id. When a node is supplied in the topic or catalog, reuse that exact id in the `id`, `from`, and `to` fields. Do not change its case, prefix, or format.
- If you discover a genuinely new candidate that is not in the supplied topic/catalog, use a lowercase hyphenated slug. Do not add `found:` or any other prefix; the system attaches labels.
- The `name` field of a node is the human-readable display name and must not include the id.
