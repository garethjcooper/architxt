### Mindmap syntax

Start with `mindmap`.

A mindmap is a tree of nodes. Indentation determines depth.

Node shapes:

- `Root` — default
- `id[Square]` — square
- `id(Rounded)` — rounded square
- `id((Circle))` — circle
- `id))Bang((` — bang
- `id)Cloud(` — cloud
- `id{{Hexagon}}` — hexagon
- `id["Markdown\n**label**"]` — multi-line markdown label

Example:

```json
{ "type": "mindmap", "content": "mindmap\n  root((Billing))\n    Architecture\n      Rating\n      Invoicing\n    Data\n      Customer\n      Usage\n    Integrations\n      CRM\n      Payments" }
```

Rules:
- The root should usually have a shape to render correctly.
- Indent child nodes with 2 or 4 spaces under their parent.
- Node labels should be plain display names followed by the canonical entity id in the form `Display Name example-type:EXAMPLE-001`. Do NOT use parentheses `()`, square brackets `[]`, or the narrative entity-reference format `[[Name (type:id)]]` inside Mermaid labels. The id must be a plain space-separated `type:id` suffix. Wrong: `Example System (EXAMPLE-001)` or `[[Example System (example-type:EXAMPLE-001)]]`. Right: `Example System example-type:EXAMPLE-001`. Do not put raw catalog references such as `EXT:EXT-ERP-001` or `A-C:XFR-ENG-001` inside node labels as plain text.
- Do not use flowchart arrows; the hierarchy is defined by indentation only.
- One node per line.
- No blank lines inside the Mermaid source.
