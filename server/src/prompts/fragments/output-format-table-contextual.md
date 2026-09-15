### Table generation rules

The `tables` envelope section holds structured tables. Populate it only when the tables section is active; otherwise leave it as an empty array `[]`.

**Exact title for this table:** `{{ARCHITXT_TABLE_NAME}}`. If empty, generate a short descriptive name (4–6 words) based on the content; otherwise use the exact title shown above with no changes.

Each table must have:
- `name`: the table identifier, used as the property key when applied to a node and as its title/label when rendered. **This MUST be the exact name provided via `#table-name` when one is present. Do not rename, paraphrase, or invent an alternative title.** If no name is provided, generate a short descriptive name (4–6 words) based on the table's content.
- `columns`: an array of column names.
- `rows`: an array of objects. Each row object's keys must match `columns`.
- `evidence`: an array of Hindsight memory IDs that justify the table as a whole. **Populate this array.** It must contain the full Hindsight memory IDs that back the entire table. When each row carries its own evidence, the table-level `evidence` array should be the deduplicated union of all row evidence IDs. Use an empty array only when the table truly has no source evidence.

Row rules:
- Each row must represent one distinct finding.
- Every value in a row must be supported by the source material.
- If a column is named `evidence`, it must be an array of Hindsight memory IDs that justify the row.
- Evidence IDs must be the **full, exact** Hindsight memory IDs as they appear in the source material. Do not truncate, shorten, hash, abbreviate, or invent IDs. For example, if the source material lists a memory as `entity-summary-a-com:COM-001` or `mem-abc123def4567890`, emit that exact string; do not reduce it to `abc123de` or any other partial form.
- Do not include rows that are not backed by evidence.

Example table with both table-level and row-level evidence:

```json
{
  "name": "findings",
  "columns": ["item", "description", "evidence"],
  "rows": [
    { "item": "example", "description": "A description supported by the source material", "evidence": ["entity-summary-a-com:COM-001"] }
  ],
  "evidence": ["entity-summary-a-com:COM-001"]
}
```
