### Swimlane diagram syntax

Start with `swimlane-beta`, optionally followed by `LR` or `TB`.

Lanes are declared with `subgraph {name}`. Nodes and edges inside a lane are indented under that subgraph. Nodes use standard flowchart shapes:

- `{id}["{label}"]` — rectangle
- `{id}(["{label}"])` — rounded
- `{id}[["{label}"]]` — subroutine
- `{id}[("{label}")]` — database
- `{id}(("{label}"))` — circle
- `{id}>"{label}"]` — asymmetric
- `{id}({"{label}"})` — stadium
- `{id}{{"{label}"}}` — hexagon
- `{id}[/"{label}"/]` — parallelogram
- `{id}[\|{label}\]` — trapezoid
- `{id}{"{label}"}` — diamond / decision

Edges:

- `{idA} --> {idB}` — arrow
- `{idA} -->|{label}| {idB}` — labeled arrow
- `{idA} -.-> {idB}` — dotted arrow
- `{idA} ==> {idB}` — thick arrow

Example:

```json
{ "type": "swimlane-beta", "content": "swimlane-beta LR\n  subgraph Customer\n    start([\"Request\"])\n  end\n  subgraph System\n    proc([\"Process\"])\n  end\n  start --\u003e proc" }
```

Rules:
- Use `subgraph {name}` for lanes, not `lane {name}` or `::Name`.
- Indent nodes inside their `subgraph`, then close it with `end`.
- Only use the node shapes listed above.
- One declaration or edge per line.
- No blank lines inside the Mermaid source.
