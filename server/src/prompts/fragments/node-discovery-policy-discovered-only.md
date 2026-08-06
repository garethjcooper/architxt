### Node discovery policy — discovered only

**CRITICAL: valid graph rule.** Every `id` used in `edges[*].from` or `edges[*].to` MUST also appear in the `nodes` array. Before emitting the graph, verify each edge endpoint has a matching node entry. A graph with dangling edge endpoints is invalid.

**CRITICAL: ordering rule.** Build the `nodes` array FIRST. Only after every endpoint node exists should you add edges. Do not add an edge unless both of its endpoints are already in `nodes`.

You must return **ONLY** newly discovered nodes and edges that are **NOT** already listed in the entity catalog above.

Allowed nodes:
- Emit discovered nodes for persistent named architectural elements identified in the source material that are **not** in the entity catalog above. Use a bare lowercase hyphenated slug as the node id and set `"provenance": "discovered"`.
- Emit known entities from the entity catalog above **only** when they are endpoints of a discovered edge. Include them exactly once each in `nodes` and mark them as known.
- If a source-material element matches a name or id already in the entity catalog above, reuse that canonical id. Do **not** emit a separate discovered node for it.

Node provenance:
- Set `"provenance": "discovered"` on every discovered node.
- Set `"provenance": "known"` and `"source": "known"` on every known entity endpoint node.

Allowed edges:
- Every emitted edge must involve at least one discovered node.
- Acceptable edge endpoint pairs are:
  - discovered → discovered
  - discovered → known entity
  - known entity → discovered

Edge provenance:
- Do **not** include a `provenance` field on edges. The system derives edge provenance from the endpoint node provenance.

Forbidden:
- Do **not** emit a standalone known entity that is not an endpoint of a discovered edge.
- Do **not** emit any edge whose endpoints are both known entities from the entity catalog above.
- Do **not** omit a known endpoint node from the `nodes` array.
- Do **not** emit a discovered node for an element already listed in the entity catalog above.

If no discovered nodes or edges are appropriate for the topic, return an empty graph:

```json
{"nodes": [], "edges": []}
```
