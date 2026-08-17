### Mindmap syntax

Start with `mindmap`.

- Root node is the first line after `mindmap`.
- Indent child nodes with two or four spaces. Do not mix indentation widths.
- Node labels may be plain text or double-quoted if they contain spaces.
- Optional shape prefix: `square`, `rounded-square`, `circle`, `cloud`, `bang`, `hexagon`, `default`.
- One node per line.
- No blank lines inside the Mermaid source.

Example:
```json
{ "type": "mindmap", "content": "mindmap\n  root((Architecture))\n    Services\n      API\n      Web" }
```
