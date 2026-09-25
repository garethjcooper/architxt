### Table generation rules

The `tables` envelope section holds structured tables. Populate it only when the tables section is active; otherwise leave it as an empty array `[]`.

Each bullet in `ARCHITXT_TABLE_FOCUS` is a separate requested table. Emit exactly as many `tables` array items as there are non-empty bullets in `ARCHITXT_TABLE_FOCUS`. Do not merge multiple table bullets into one array item, and do **not** create narrative entries for table sections. Tables belong only in `tables[]`.

For each `tables[]` item:
- `name`: the exact title shown in the focus bullet. If the bullet has a bold name (e.g. `- **Example Table Name** — ...`), use that exact bold text. **This MUST be the exact name provided via `#table-name` when one is present. Do not rename, paraphrase, or invent an alternative title.** If the bullet has no name, generate a short descriptive name (4–6 words) based on the table's content.
- `columns`: an array of column names.
- `rows`: an array of objects. Each row object's keys must match `columns`.
- `evidence`: an array of Hindsight memory IDs that justify the table as a whole. **Populate this array.** It must contain the full Hindsight memory IDs that back the entire table. When each row carries its own evidence, the table-level `evidence` array should be the deduplicated union of all row evidence IDs. Use an empty array only when the table truly has no source evidence.

Row rules:
- Each row must represent one distinct finding.
- Every value in a row must be supported by the source material.
- If a column is named `evidence`, it must be an array of Hindsight memory IDs that justify the row.
- Evidence IDs must be the **full, exact** Hindsight memory IDs as they appear in the source material. Do not truncate, shorten, hash, abbreviate, or invent IDs. For example, if the source material lists a memory as `entity-summary-a-com:COM-001` or `mem-abc123def4567890`, emit that exact string; do not reduce it to `abc123de` or any other partial form.
- Do not include rows that are not backed by evidence.
- Do not summarise a table's content in the `narratives[]` section. A table section is fully expressed by its own `tables[]` entry.

Example — when `ARCHITXT_TABLE_FOCUS` is:
```
- **Example Table A** — List each connection to Example A with Source, Target, Protocol, and Content.
- **Example Table B** — List each connection to Example B with Source, Target, Protocol, and Content.
```

Emit exactly:
```json
{
  "tables": [
    {
      "name": "Example Table A",
      "columns": ["Source", "Target", "Protocol", "Content"],
      "rows": [...],
      "evidence": []
    },
    {
      "name": "Example Table B",
      "columns": ["Source", "Target", "Protocol", "Content"],
      "rows": [...],
      "evidence": []
    }
  ]
}
```

A section requested as a table must appear only in `tables[]`, not in `narratives[]` or `diagrams[]`.
