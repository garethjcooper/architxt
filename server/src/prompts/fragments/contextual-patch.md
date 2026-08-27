### Output format

Return ONLY a valid, parseable JSON object. No Markdown fences, no Markdown headings, no code blocks, no surrounding prose. The output must be raw, parseable JSON that `JSON.parse` can consume directly. Ensure all control characters inside string values are properly escaped (e.g., newlines as `\n`, tabs as `\t`).

Required envelope:

{"narrative":"Markdown prose with paragraphs, or empty string.","narrative_name":"","graph":{"name":"","nodes":[],"edges":[]},"tables":[],"diagrams":[]}

All five top-level keys are required. Empty arrays or an empty string are acceptable, but the keys must not be omitted.

- `narrative` is for human-readable prose. Only populate it when the narrative section is active. If the active sections are graph, tables, or diagrams only, set `narrative` to an empty string and express all findings through those structured sections.
- `narrative_name` is the short title/label for the narrative section when it is active. **This MUST be the exact title provided via `#narrative-name` when one is present. Do not rename, paraphrase, or invent an alternative title.** If no name is provided, generate a short descriptive name (4–6 words) based on the narrative's content, or leave empty if narrative is not active.
- `graph` is for nodes and edges. Graph generation rules live in `output-format-graph-contextual.md`.
- `tables` is for structured tables. Table generation rules live in `output-format-table-contextual.md`.
- `diagrams` is for Mermaid diagrams. Diagram generation rules live in `output-format-diagram-contextual.md`.

The example below shows the envelope structure with all sections empty. **Which sections to populate and which to leave empty is governed by the Section rules injected below.** Your actual response must NOT include the code fence, the triple backticks, or any backslash-escaped quotes:

```json
{"narrative":"","narrative_name":"","graph":{"name":"","nodes":[],"edges":[]},"tables":[],"diagrams":[]}
```

Before finishing, verify that the response starts with `{` and ends with `}` and contains no unescaped control characters.
