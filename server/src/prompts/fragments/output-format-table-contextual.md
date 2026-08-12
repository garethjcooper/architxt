### Table generation rules

The `tables` envelope section must contain a list of table objects.

Each table must have:
- `name`: the table identifier, used as the property key when applied to a node.
- `columns`: an array of column names.
- `rows`: an array of objects. Each row object's keys must match `columns`.

Row rules:
- Each row must represent one distinct finding.
- Every value in a row must be supported by the source material.
- If a column is named `evidence`, it must be an array of Hindsight memory IDs that justify the row.
- Do not include rows that are not backed by evidence.

Example table:

```json
{ "name": "capabilities", "columns": ["name", "responsibility", "purpose", "business_capability_mapping", "evidence"], "rows": [{ "name": "billing", "responsibility": "Calculates and issues invoices", "purpose": "Ensures revenue is captured", "business_capability_mapping": "Finance / Revenue Management", "evidence": ["mem-def456"] }] }
```
