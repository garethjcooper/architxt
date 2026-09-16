### Output format

Return ONLY a valid, parseable JSON object. No Markdown fences, no Markdown headings, no code blocks, no surrounding prose. The output must be raw, parseable JSON that `JSON.parse` can consume directly. Ensure all control characters inside string values are properly escaped (e.g., newlines as `\\n`, tabs as `\\t`).

Required envelope:

```json
{
  "narratives": [{"narrative_name": "", "narrative": "Markdown prose with paragraphs, or empty string.", "evidence": []}],
  "graph": {"name": "", "nodes": [], "edges": []},
  "tables": [],
  "diagrams": []
}
```

All five top-level keys are required. Empty arrays or an empty string are acceptable, but the keys must not be omitted.

Only populate envelope sections when the corresponding output section is active. Inactive sections must be left empty exactly as shown above. If the active sections are `graph`, `tables`, or `diagrams` only, set `narratives` to an empty array and express all findings through the structured output sections.

Detailed rules for each active section follow later in this prompt, after the active/empty section list. Common rules that apply to every section:

- Evidence values must be the **full, exact** Hindsight memory IDs as they appear in the source material. Do not truncate, shorten, hash, abbreviate, or invent IDs.
- If a section is inactive, leave it exactly in the empty form shown above. Do not fill it with prose, placeholders, or markdown tables.
- Do not inline evidence IDs, citations, bracketed references such as `【...】`, parenthesized UUIDs such as `(uuid-here)`, or any other source markers inside rendered prose. Evidence belongs only in the `evidence` array.

Empty envelope to copy when all structured sections are inactive:

```json
{"narratives":[],"graph":{"name":"","nodes":[],"edges":[]},"tables":[],"diagrams":[]}
```

Before finishing, verify that the response starts with `{` and ends with `}` and contains no unescaped control characters.
