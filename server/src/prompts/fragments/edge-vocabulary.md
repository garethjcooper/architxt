### Edge/Relationship vocabulary

Use only these edge types. Direction is implicit: each type is expressed from the `from` node toward the `to` node.

| Edge type | Direction | Meaning |
|---|---|---|
| `calls` | `from` → `to` | `from` invokes a service or other exposed utility or interface on `to`. |
| `sends` | `from` → `to` | `from` delivers an object such as data, file, atomic packet to `to`. |
| `event` | `from` → `to` | `from` sends an event to `to`. |
| `flow` | `from` → `to` | `from` flows, interacts or is related `to`. A generalised interaction between `from` and `to`. Use only when no more specific type applies. |

Rules:
- Do not prefix edge types with any node-state marker.
- For bidirectional relationships, use the most specific type and a label like "bidirectional sync".
- If an old source describes "A receives from B", express it as `B sends A`.
- Every edge `from` and `to` must be a node id that appears in the `nodes` list.
