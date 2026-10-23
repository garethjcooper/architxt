### Architecture diagram syntax

Start with `architecture-beta`.

Elements:

- `group {groupId}({iconName})["{title}"] (in {parentId})?` — groups one or more services.
- `service {serviceId}({iconName})["{title}"] (in {parentId})?` — a service inside a group or at the top level.
- Supported icons include `cloud`, `database`, `disk`, `server`, and others from the Mermaid icon set.

Edges:

- `{serviceId}:{T|B|L|R} {<}?--{>}? {T|B|L|R}:{serviceId}`
- Attach a side to each endpoint: `T` (top), `B` (bottom), `L` (left), `R` (right).
- Add `<` or `>` for arrow direction, or omit both for an undirected line.

Example:

```json
{ "type": "architecture-beta", "content": "architecture-beta\n  group api(cloud)[\"API\"]\n    service db(database)[\"Database\"] in api\n    service server(server)[\"Server\"] in api\n  db:L -- R:server" }
```

Rules:
- Edge labels: if the provided context includes an existing contextual-graph or mental-model edge between the same two services, reuse its exact `label` and `type` for the architecture edge. Only generate a new label when no such edge exists. Direction does not matter for this lookup.
- Only use the `service`/`group` declarations shown above.
- Node labels should be plain display names followed by the canonical entity id in the form `Display Name example-type:EXAMPLE-001`. Do NOT use parentheses `()`, square brackets `[]`, or the narrative entity-reference format `[[Name (type:id)]]` inside Mermaid labels. The id must be a plain space-separated `type:id` suffix. Wrong: `Example System (EXAMPLE-001)` or `[[Example System (example-type:EXAMPLE-001)]]`. Right: `Example System example-type:EXAMPLE-001`. Do not put raw catalog references such as `EXT:EXT-ERP-001` or `A-C:XFR-ENG-001` inside node labels as plain text.
- Every edge must specify the side on both endpoints (e.g. `db:L -- R:server`).
- Do not use flowchart arrows like `web --> api` without side ports.
- One declaration or edge per line.
- No blank lines inside the Mermaid source.
