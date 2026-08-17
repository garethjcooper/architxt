### Swimlane syntax

Start with `swimlane-beta` followed by an optional direction: `TB`, `TD`, `BT`, `LR`, `RL`.

- Lane separator: `::LaneName`
- Place nodes under a lane by indenting or by declaring them after `::LaneName`.
- Node IDs must be plain ASCII identifiers with no spaces or special characters.
- Node labels must be in double quotes if they contain spaces or special characters.
- Directed edges between nodes: `-->` or `-.->`.
- One edge per line.
- Do not nest lanes. Do not use `classDef`, `style`, or `subgraph`.

Example:
```json
{ "type": "swimlane-beta", "content": "swimlane-beta\n  ::Customer\n    start[\"Request\"]\n  ::System\n    proc[\"Process\"]\n  start --> proc" }
```
