### Architecture diagram syntax

Start with `architecture-beta`.

- Groups: `group groupId["Group Label"] { ... }`.
- Services: `service serviceId("IconName")["Label"]`.
- Junctions: `junction junctionId`.
- Edges: `serviceId --> anotherServiceId` or `serviceId --> junctionId --> targetId`.
- IDs must be plain ASCII identifiers with no spaces or special characters.
- Labels in `[]` or `()` must use double quotes if they contain spaces.
- Inside quoted labels, do NOT use `"`, `[`, `]`, `{`, `}`, or `|`.
- One edge per line.
- No blank lines inside the Mermaid source.

Example:
```json
{ "type": "architecture-beta", "content": "architecture-beta\n  service web(cloud)[\"Web App\"]\n  service api(cloud)[\"API\"]\n  web --> api" }
```
