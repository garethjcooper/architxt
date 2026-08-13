### Output format

Return ONLY a valid, parseable JSON object. No Markdown fences, no Markdown headings, no code blocks, no surrounding prose, and no escaped quotes (`\"`). The output must be raw JSON that `JSON.parse` can consume directly.

Required envelope:

{"narrative":"Markdown prose with paragraphs, or empty string.","graph":{"nodes":[],"edges":[]},"tables":[]}

All three top-level keys are required. Empty arrays or an empty string are acceptable, but the keys must not be omitted.

- `narrative` is for human-readable prose. **Must be empty when structured output sections (graph, tables) are requested.** Only include narrative prose when explicitly requested via a `#narrative` directive.
- `graph` is for nodes and edges. Graph generation rules live in `output-format-graph-contextual.md`.
- `tables` is for structured tables. Table generation rules live in `output-format-table-contextual.md`.

The example below shows the envelope structure with all sections empty. **Only populate the sections explicitly requested in the directives above; leave the rest exactly as shown** (empty string, empty arrays, or empty objects). Your actual response must NOT include the code fence, the triple backticks, or any backslash-escaped quotes:

```json
{"narrative":"","graph":{"nodes":[],"edges":[]},"tables":[]}
```

Before finishing, verify that the response starts with `{` and ends with `}` and contains no unescaped control characters.
