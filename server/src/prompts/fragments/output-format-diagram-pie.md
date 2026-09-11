### Pie chart syntax

Start with `pie`.

- `pie title {text}` — optional title.
- `pie showData title {text}` — show percentages on slices.
- `"{label}" : {value}` — a slice.

Donut chart:

- `pie showData` plus the slice lines renders a donut in Mermaid v11.16+.

Example:

```json
{ "type": "pie", "content": "pie title Adoption by channel\n  \"Web\" : 386\n  \"Mobile\" : 85\n  \"Store\" : 15" }
```

Rules:
- Labels must be in double quotes.
- Values must be numbers.
- One slice per line.
- No blank lines inside the Mermaid source.
