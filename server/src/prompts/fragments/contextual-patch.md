### Output format

Return ONLY a JSON object in this exact envelope (no markdown fences, no extra prose):

{"narrative":"Markdown prose with paragraphs, or empty string.","graph":{"nodes":[],"edges":[]},"tables":[]}

All three top-level keys are required. Empty arrays or an empty string are acceptable, but the keys must not be omitted.

- `narrative` is for human-readable prose. It may be empty for data-only models.
- `graph` is for nodes and edges. Graph generation rules live in `output-format-graph-contextual.md`.
- `tables` is for structured tables. Table generation rules live in `output-format-table-contextual.md`.

Example of a fully populated envelope:

```json
{
  "narrative": "Example System A processes payments and emits invoices.",
  "graph": {
    "nodes": [
      { "id": "example-type:EXAMPLE-001", "name": "Example System A", "type": "component" }
    ],
    "edges": [
      { "from": "example-type:EXAMPLE-001", "to": "example-type:EXAMPLE-002", "type": "calls", "label": "processes payments", "detail": "Example System A calls Example System B to process payments.", "evidence": ["mem-1"] }
    ]
  },
  "tables": [
    { "name": "capabilities", "columns": ["name", "evidence"], "rows": [{ "name": "billing", "evidence": ["mem-2"] }] }
  ]
}
```
