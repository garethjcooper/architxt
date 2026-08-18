### Table generation rules

The `tables` envelope section must contain a list of table objects.

Each table must have:
- `name`: the table identifier, used as the property key when applied to a node. **This MUST be the exact name provided via `#table-name` when one is present. Do not rename, paraphrase, or invent an alternative title.** If no name is provided, generate a short descriptive name (4–6 words) based on the table's content.
- `columns`: an array of column names.
- `rows`: an array of objects. Each row object's keys must match `columns`.

Row rules:
- Each row must represent one distinct finding.
- Every value in a row must be supported by the source material.
- If a column is named `evidence`, it must be an array of Hindsight memory IDs that justify the row.
- Do not include rows that are not backed by evidence.

Example table:

```json
{ "name": "findings", "columns": ["item", "description", "evidence"], "rows": [{ "item": "example", "description": "A description supported by the source material", "evidence": ["mem-def456"] }] }
```
