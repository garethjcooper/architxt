### Narrative generation rules

The `narratives` envelope section holds human-readable Markdown prose. Populate it only when the narrative section is active; otherwise leave it as an empty array `[]`.

Each bullet in `ARCHITXT_NARRATIVE_FOCUS` is a separate requested narrative. Emit exactly as many `narratives` array items as there are non-empty bullets in `ARCHITXT_NARRATIVE_FOCUS`. Do not merge multiple narrative bullets into one array item, and do **not** create narrative entries for table, graph, or diagram sections. Tables belong in `tables[]`; diagrams belong in `diagrams[]`; graphs belong in the single `graph` object.

For each narrative array item:
- `narrative_name`: the exact title shown in the focus bullet. If the bullet has a bold name (e.g. `- **Example Section Name** — ...`), use that exact bold text. If the bullet has no name, generate a short descriptive name (4–6 words) based on the content. Do not rename, paraphrase, or invent an alternative title when a name is shown.
- `narrative`: clean Markdown prose that answers the bullet's request. Empty string only if the source material contains nothing relevant. Do NOT inline evidence IDs, citations, bracketed references such as `【...】`, parenthesized UUIDs such as `(uuid-here)`, or any other source markers inside the prose. Evidence belongs only in the `evidence` array.
- `evidence`: an array of Hindsight memory IDs backing that specific narrative section. Use an empty array when the section has no source evidence. Evidence IDs must be the **full, exact** Hindsight memory IDs as they appear in the source material. Do not truncate, shorten, hash, abbreviate, or invent IDs.

Example — when `ARCHITXT_NARRATIVE_FOCUS` is:
```
- **Example Narrative A** — Describe the capabilities of the Example A component.
- **Example Narrative B** — Describe the capabilities of the Example B component.
```

Emit exactly:
```json
{
  "narratives": [
    { "narrative_name": "Example Narrative A", "narrative": "... prose for Example A ...", "evidence": [] },
    { "narrative_name": "Example Narrative B", "narrative": "... prose for Example B ...", "evidence": [] }
  ]
}
```

If the query also asks for tables, graphs, or diagrams, those still go in `tables[]`, `graph`, and `diagrams[]`; do not add extra `narratives[]` entries summarising them.

Do not put a second narrative's heading inside the first narrative's `narrative` string. Each requested narrative focus bullet becomes its own array element.

Do not create narrative entries for graph, table, or diagram focus bullets. A section requested as a table must appear only in `tables[]`, not in `narratives[]`.
