### Output format

Return ONLY a valid, parseable JSON object. No Markdown fences, no Markdown headings, no code blocks, no surrounding prose. The output must be raw, parseable JSON that `JSON.parse` can consume directly. Ensure all control characters inside string values are properly escaped (e.g., newlines as `\n`, tabs as `\t`).

Required envelope:

{"narrative":"Markdown prose with paragraphs, or empty string.","graph":{"nodes":[],"edges":[]},"tables":[]}

All three top-level keys are required. Empty arrays or an empty string are acceptable, but the keys must not be omitted.

- `narrative` is for human-readable prose. Whether to populate it is governed by the **Section rules** injected below.
- `graph` is for nodes and edges. Graph generation rules live in `output-format-graph-contextual.md`.
- `tables` is for structured tables. Table generation rules live in `output-format-table-contextual.md`.

The example below shows the envelope structure with all sections empty. **Only populate the sections explicitly requested in the directives above; leave the rest exactly as shown** (empty string, empty arrays, or empty objects). Your actual response must NOT include the code fence, the triple backticks, or any backslash-escaped quotes:

```json
{"narrative":"","graph":{"nodes":[],"edges":[]},"tables":[]}
```

Before finishing, verify that the response starts with `{` and ends with `}` and contains no unescaped control characters.
