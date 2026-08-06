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

When the discovery policy allows discovered nodes, the graph may also contain discovered nodes:

```json
{
  "nodes": [
    { "id": "payment-gateway", "name": "Payment Gateway", "provenance": "discovered" },
    { "id": "example-type:EXAMPLE-001", "name": "Example System A", "provenance": "known", "source": "known" }
  ],
  "edges": [
    {
      "from": "example-type:EXAMPLE-001",
      "to": "payment-gateway",
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
    { "id": "invoice-delivery-interface", "name": "Invoice Delivery Interface", "provenance": "discovered" },
    { "id": "example-type:EXAMPLE-001", "name": "Example System A", "provenance": "known", "source": "known" }
  ],
  "edges": [
    {
      "from": "example-type:EXAMPLE-001",
      "to": "invoice-delivery-interface",
      "type": "sends",
      "label": "invoices",
      "detail": "Example System A sends invoices to the discovered delivery interface."
    }
  ]
}
```

Field rules:
- `id`: stable node id. Known entities use their canonical entity id from the catalog. Genuinely discovered entities use a bare lowercase hyphenated slug. Do not add `found:` or any other prefix.
- `name`: human-readable name only; must not include the id.
- `from` / `to`: source and target node ids. Every endpoint id must also appear in `nodes`.
- `type`: one of `calls`, `sends`, `reads`, `writes`, `depends-on`.
- `label`: short phrase, max 4 words.
- `detail`: full description, max 2 sentences; empty string if not justified.
- Do not include a `provenance` field on edges. The system derives edge provenance from the endpoint node provenance.
- Only include `provenance` on a node when the active discovery policy explicitly requires it.

**CRITICAL: connected-node rule.** Every node in the `nodes` array must be an endpoint of at least one emitted edge (as `from` or `to`). Do not return a graph that has nodes but zero edges — an isolated node is not useful. Before returning the graph, remove any isolated node. If this leaves no edges, return an empty graph instead:

```json
{"nodes": [], "edges": []}
```

If no graph is justified, return an empty graph object after the heading:

```json
{"nodes": [], "edges": []}
```
