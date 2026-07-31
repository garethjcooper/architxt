### Output format

Return only a graph section. Do not write a narrative or any explanatory text outside the graph block.

Use this exact structure:

## ARCHITXT-GRAPH-DATA
```json
{"nodes": [...], "edges": [...]}
```

The heading must appear exactly as `## ARCHITXT-GRAPH-DATA` on its own line. The JSON graph object must follow immediately inside a json-fenced code block. Do not wrap the heading itself in a code fence.

Example for a graph of known entities only:

```json
{
  "nodes": [
    { "id": "example-type:EXAMPLE-001", "name": "Example System A" },
    { "id": "example-type:EXAMPLE-002", "name": "Example System B" }
  ],
  "edges": [
    {
      "from": "example-type:EXAMPLE-001",
      "to": "example-type:EXAMPLE-002",
      "type": "sends",
      "label": "usage data",
      "detail": "Billable usage events flow from Example System A to Example System B."
    }
  ]
}
```

When the discovery policy allows `found:` nodes, the graph may also contain discovered nodes:

```json
{
  "nodes": [
    { "id": "found:payment-gateway", "name": "Payment Gateway", "provenance": "discovered" },
    { "id": "example-type:EXAMPLE-001", "name": "Example System A", "provenance": "known", "source": "known" }
  ],
  "edges": [
    {
      "from": "example-type:EXAMPLE-001",
      "to": "found:payment-gateway",
      "type": "sends",
      "label": "payment events",
      "detail": "Example System A sends payment events to the discovered payment gateway."
    }
  ]
}
```

Discovered-only policy example: when only newly discovered entities are requested, reuse canonical ids from the entity catalog above for known endpoints and drop any isolated node:

```json
{
  "nodes": [
    { "id": "found:invoice-delivery-interface", "name": "Invoice Delivery Interface", "provenance": "discovered" },
    { "id": "example-type:EXAMPLE-001", "name": "Example System A", "provenance": "known", "source": "known" }
  ],
  "edges": [
    {
      "from": "example-type:EXAMPLE-001",
      "to": "found:invoice-delivery-interface",
      "type": "sends",
      "label": "invoices",
      "detail": "Example System A sends invoices to the discovered delivery interface."
    }
  ]
}
```

Field rules:
- `id`: canonical entity id. Known: `TYPE:ENTITY-ID`. Discovered: `found:{slug}`.
- `name`: human-readable name only; must not include the id.
- `from` / `to`: source and target node ids. Every endpoint id must also appear in `nodes`.
- `type`: one of `calls`, `sends`, `reads`, `writes`, `depends-on`.
- `label`: short phrase, max 4 words.
- `detail`: full description, max 2 sentences; empty string if not justified.
- Do not include a `provenance` field on edges. The system derives edge provenance from the endpoint ids.
- Only include `provenance` on a node when the active discovery policy explicitly requires it.

**CRITICAL: connected-node rule.** Every node in the `nodes` array must be an endpoint of at least one emitted edge (as `from` or `to`). Do not return a graph that has nodes but zero edges — an isolated node is not useful. Before returning the graph, remove any isolated node. If this leaves no edges, return an empty graph instead:

```json
{"nodes": [], "edges": []}
```

If no graph is justified, return an empty graph object after the heading:

```json
{"nodes": [], "edges": []}
```
