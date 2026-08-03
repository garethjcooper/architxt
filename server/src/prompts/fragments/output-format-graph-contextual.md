### Graph generation rules

The `graph` envelope section must contain a `nodes` array and an `edges` array.

Node field rules:
- `id`: canonical entity id. Known entities use `TYPE:ENTITY-ID`. Discovered candidates use `found:{slug}`.
- `name`: human-readable name only; must not include the id.
- `type`: the entity type.

Edge field rules:
- `from` / `to`: source and target node ids. Every endpoint id must also appear in `nodes`.
- `type`: one of `calls`, `sends`, `reads`, `writes`, `depends-on`.
- `label`: short phrase, max 4 words.
- `detail`: full description, max 2 sentences; empty string if not justified.
- `evidence`: array of Hindsight memory IDs.
- Do not include a `provenance` field on edges. The system derives edge provenance from the endpoint ids.
- Multiple edges per node pair are allowed when the interactions differ by direction, type, or context. Do not collapse distinct interactions into a single combined edge.

Example edge:

```json
{ "from": "example-type:EXAMPLE-001", "to": "example-type:EXAMPLE-002", "type": "sends", "label": "usage data", "detail": "Example System A sends usage data to Example System B.", "evidence": ["mem-abc123"] }
```

Connected-node rule:
Every node in the `nodes` array must be an endpoint of at least one emitted edge (as `from` or `to`). Do not return a graph that has nodes but zero edges. Before returning the graph, remove any isolated node. If this leaves no edges, return an empty graph instead: `{"nodes":[],"edges":[]}`. If no graph is justified, return an empty graph object.
