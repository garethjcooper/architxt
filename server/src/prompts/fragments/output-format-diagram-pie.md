### Pie chart syntax

Start with `pie`.

- Optional `showData` after `pie` to display values.
- Optional title: `title My Title`.
- Data rows: `"Label" : numericValue`.
- Labels with spaces must be in double quotes. Inside quoted labels, do NOT use `"`, `[`, `]`, `{`, `}`, or `|`.
- Values must be non-negative numbers (integers or decimals).
- One data row per line.
- No blank lines inside the Mermaid source.

Example:
```json
{ "type": "pie", "content": "pie\n  title Error sources\n  \"Validation\" : 12\n  \"Network\" : 5" }
```
