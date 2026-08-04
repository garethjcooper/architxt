### Output format

Return ONLY a valid, parseable JSON object. No Markdown fences, no Markdown headings, no code blocks, no surrounding prose, and no escaped quotes (`\"`). The output must be raw JSON that `JSON.parse` can consume directly.

Required envelope:

{"narrative":"Markdown prose with paragraphs, or empty string.","graph":{"nodes":[],"edges":[]},"tables":[]}

All three top-level keys are required. Empty arrays or an empty string are acceptable, but the keys must not be omitted.

- `narrative` is for human-readable prose. It may be empty for data-only models.
- `graph` is for nodes and edges. Graph generation rules live in `output-format-graph-contextual.md`.
- `tables` is for structured tables. Table generation rules live in `output-format-table-contextual.md`.

The example below is shown inside a code fence only for readability. Your actual response must NOT include the fence, the triple backticks, or any backslash-escaped quotes:

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

Before finishing, verify that the response starts with `{` and ends with `}` and contains no unescaped control characters.
