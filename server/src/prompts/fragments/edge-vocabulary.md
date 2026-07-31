### Edge vocabulary

Use only these edge types. Direction is implicit: each type is expressed from the `from` node toward the `to` node.

| Edge type | Direction | Meaning |
|---|---|---|
| `calls` | `from` → `to` | `from` invokes or calls `to`. |
| `sends` | `from` → `to` | `from` sends data or an event to `to`. |
| `reads` | `from` → `to` | `from` reads data from `to`. |
| `writes` | `from` → `to` | `from` persists or writes data to `to`. |
| `depends-on` | `from` → `to` | `from` depends on `to`. Use only when no more specific type applies. |

Rules:
- Do not prefix edge types with `found:`.
- For bidirectional relationships, use the most specific type and a label like "bidirectional sync".
- If an old source describes "A receives from B", express it as `B sends A`.
- Every edge `from` and `to` must be a node id that appears in the `nodes` list.
