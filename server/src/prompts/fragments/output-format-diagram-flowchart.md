### Flowchart / graph diagram syntax

Start with `flowchart` or `graph`, followed by a direction: `TB`, `TD`, `BT`, `LR`, `RL`.

Nodes are declared by an id and a shape:

- `id1[Text]` — rectangle
- `id1(Rounded text)` — rounded rectangle
- `id1((Circular text))` — circle
- `id1{Diamond text}` — diamond / decision
- `id1[/Parallelogram text/]` — parallelogram
- `id1[\Trapezoid text\]` — trapezoid
- `id1{{Hexagon text}}` — hexagon
- `id1[[Subroutine text]]` — subroutine
- `id1[(Database text)]` — database/cylinder
- `id1((Double circle text))` — double circle

Arrows:

- `id1 --> id2` — solid arrow
- `id1 -.-> id2` — dotted arrow
- `id1 ==> id2` — thick arrow
- `id1 -- text --> id2` — labeled arrow
- `id1 --x id2` — arrow with cross
- `id1 --o id2` — circle arrowhead
- `id1 -> id2` — open arrowhead
- `id1 -->|id2` — async (stroke)

Subgraphs:

```text
subgraph title
    id1 --> id2
end
```

Example:

```json
{ "type": "flowchart", "content": "flowchart LR\n  A[\"Billing\"] --\u003e B(\"Rating\")\n  B --\u003e C{\"Valid?\"}\n  C --\u003e|Yes| D[\"Invoice\"]\n  C --\u003e|No| E[\"Reject\"]" }
```

Rules:
- Node IDs must be plain identifiers with no spaces, parentheses, brackets, braces, quotes, colons, slashes, or special characters. Labels go inside the shape brackets.
- Use `flowchart` for new diagrams; `graph` is the legacy alias.
- One node or edge per line.
- No blank lines inside the Mermaid source.
