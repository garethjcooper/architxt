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
- Do not use flowchart arrows; the hierarchy is defined by indentation only.
- One node per line.
- No blank lines inside the Mermaid source.
