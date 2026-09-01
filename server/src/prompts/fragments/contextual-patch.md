### Output format

Return ONLY a valid, parseable JSON object. No Markdown fences, no Markdown headings, no code blocks, no surrounding prose. The output must be raw, parseable JSON that `JSON.parse` can consume directly. Ensure all control characters inside string values are properly escaped (e.g., newlines as `\n`, tabs as `\t`).

Required envelope:

{"narratives":[{"narrative_name":"","narrative":"Markdown prose with paragraphs, or empty string."}],"graph":{"name":"","nodes":[],"edges":[]},"tables":[],"diagrams":[]}

All five top-level keys are required. Empty arrays or an empty string are acceptable, but the keys must not be omitted.

- `narratives` is an array of narrative sections. Each entry has `narrative_name` and `narrative`. Only populate entries when the narrative section is active. If the active sections are graph, tables, or diagrams only, set `narratives` to an empty array and express all findings through the structured output sections.
- `narrative_name` inside a `narratives` entry is the short title/label for that narrative section. **This MUST be the exact title provided via `#narrative-name` when one is present. Do not rename, paraphrase, or invent an alternative title.** If no name is provided, generate a short descriptive name (4–6 words) based on the narrative's content, or leave empty.
- `graph` is for nodes and edges. Graph generation rules live in `output-format-graph-contextual.md`.
- `tables` is for structured tables. Table generation rules live in `output-format-table-contextual.md`.
- `diagrams` is for Mermaid diagrams. Diagram generation rules live in `output-format-diagram-contextual.md`.

Empty envelope to copy when sections are inactive:

```json
{"narratives":[],"graph":{"name":"","nodes":[],"edges":[]},"tables":[],"diagrams":[]}
```

Before finishing, verify that the response starts with `{` and ends with `}` and contains no unescaped control characters.
