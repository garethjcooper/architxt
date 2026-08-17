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
- Only use the `service`/`group` declarations shown above.
- Every edge must specify the side on both endpoints (e.g. `db:L -- R:server`).
- Do not use flowchart arrows like `web --> api` without side ports.
- One declaration or edge per line.
- No blank lines inside the Mermaid source.
