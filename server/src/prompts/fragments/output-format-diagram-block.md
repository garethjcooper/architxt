### Block diagram syntax

Start with `block-beta`.

Block diagram layout uses columns, blocks, arrows, and groups.

Basic structure:

```text
block-beta
  columns 3
  a["Label A"]
  b["Label B"]
  c["Label C"]
  a --> b
  b --> c
```

- `columns {n}` — defines how many columns the grid has.
- `{id}["{label}"]` — a block (square).
- `{id}("{label}")` — rounded block.
- `{id}[("{label}")]` — cylindrical / database block.
- `{id}[("{label}")]` — stadium block.
- `{id}[["{label}"]]` — subroutine block.
- `style {id} fill:#f9f,stroke:#333` — styling.

Spanning columns:

- `block:3` — block spans 3 columns.

Groups (composite blocks):

```text
block-beta
  columns 3
  block:group
    a["A"]
    b["B"]
  end
```

Arrows:

- `a --> b` — default arrow
- `a -->|label| b` — labeled arrow

Example:

```json
{ "type": "block", "content": "block-beta\n  columns 3\n  a[\"Input\"]\n  b[\"Process\"]\n  c[\"Output\"]\n  a --\u003e b\n  b --\u003e c" }
```

Rules:
- Use `block-beta`, not `block`.
- Define `columns` early so the layout is predictable.
- One block, group, arrow, or style per line.
- No blank lines inside the Mermaid source.
