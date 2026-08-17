### Block diagram syntax

Start with `block-beta`.

- Optional column count: `columns 3`.
- Block syntax: `blockId["Label"]`, with optional shape prefix: `id: shapeId["Label"]`.
- Common shapes: `round`, `stadium`, `subroutine`, `cylinder`, `circle`, `asymmetric`, `rhombus`, `hexagon`, `parallelogram`, `trapezoid`, `rectangle`.
- Blocks can span columns: `blockId["Label"]:2`.
- Edges: `blockId1 --> blockId2` or `blockId1 -.-> blockId2`.
- Composite blocks: `block
  id["Label"]
  ...
end`.
- One edge per line.
- No blank lines inside the Mermaid source.

Example:
```json
{ "type": "block", "content": "block-beta\n  columns 2\n  a[\"Input\"]\n  b{\"Process\"}\n  a --> b" }
```
