### Graph generation rules

The `graph` envelope section must contain a `nodes` array and an `edges` array.

Node field rules:
- `id`: stable working-graph id. Reuse the exact id from the topic or catalog. For genuinely new candidates not in the topic/catalog, use a lowercase hyphenated slug with no prefix.
- `name`: human-readable name only; must not include the id.
- `type`: omit for nodes that are already known to the graph. Only include it for genuinely new discovered candidates, and only when the source material explicitly introduces a classification for them.

Edge field rules:
- `from` / `to`: source and target node ids. Every endpoint id must also appear in `nodes`. Use the exact ids provided in the topic; do not invent new ids for endpoints that were already supplied.
- `type`: one of `calls`, `sends`, `reads`, `writes`, `depends-on`.
- `label`: short phrase, max 4 words.
- `detail`: structured concise description of the flow. Cover as many of the following as are supported by the source material, in one or two sentences: what is transferred, how it is transferred (protocol / format / API), how often, any known intermediaries, and any known error-handling or retry behavior. Empty string if not justified.
- `evidence`: array of Hindsight memory IDs.
- Do not include a `provenance` field on edges. The system derives edge provenance from the endpoint ids.
- Multiple edges per node pair are allowed when the interactions differ by direction, type, or context. Do not collapse distinct interactions into a single combined edge.

Example edge:

```json
{ "from": "example-type:EXAMPLE-001", "to": "example-type:EXAMPLE-002", "type": "sends", "label": "usage data", "detail": "Example System A sends usage data to Example System B. The data is sent as billable usage events via a nightly batch file through an internal SFTP gateway.", "evidence": ["mem-abc123"] }
```

Connected-node rule:
Every node in the `nodes` array must be an endpoint of at least one emitted edge (as `from` or `to`). Do not return a graph that has nodes but zero edges. Before returning the graph, remove any isolated node. If this leaves no edges, return an empty graph instead: `{"nodes":[],"edges":[]}`. If no graph is justified, return an empty graph object.
