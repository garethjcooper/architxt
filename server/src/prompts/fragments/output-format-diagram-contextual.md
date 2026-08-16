### Diagram generation rules

The `diagrams` envelope section must contain a list of diagram objects.

Each diagram must have:
- `name`: a short human-readable identifier for the diagram (used as its title/label when rendered).
- `type`: a valid Mermaid diagram type. Valid types are: `flowchart`, `graph`, `sequenceDiagram`, `classDiagram`, `stateDiagram`, `stateDiagram-v2`, `erDiagram`, `gantt`, `pie`, `mindmap`, `timeline`, `gitGraph`, `architecture-beta`, `requirementDiagram`, `journey`, `C4Context`, `C4Container`, `C4Component`, `C4Deployment`.
- `content`: a single string of valid Mermaid diagram notation. Preserve newlines inside the string as `\n` so the envelope remains JSON-parseable.

Rules:
- Only emit a diagram when it is justified by the source material and requested by the active section directives.
- The `type` must match exactly one of the allowed keywords.
- Do not wrap the `content` in Markdown fences or triple backticks; it must be the raw Mermaid source.
- When the active sections do not include diagrams, return an empty `diagrams` array.
- Node IDs must be plain alphanumeric slugs (e.g. `A`, `Singleview`, `svc_order`). Do not put parentheses, brackets, spaces, or `:` in node IDs.
- Node labels that contain parentheses, brackets, spaces, colons, or other Mermaid syntax characters must be wrapped in double quotes: `A["Singleview (COM-001)"]` or `B["BLINC"]`. Labels without special characters may omit quotes: `A[Singleview].`
- Do not include entity catalog IDs or type prefixes such as `(Company:COM-001)` in visible labels unless they are inside a quoted label.
- Use `-->` for directed arrows. Label arrows with `A -->|sends| B` only when the relationship needs annotation.

Example diagrams:

```json
{ "name": "Order sequence", "type": "sequenceDiagram", "content": "Alice->>Bob: Hello\nBob-->>Alice: Hi" }
```

```json
{ "name": "System context", "type": "flowchart", "content": "flowchart TD\n  SV[\"Singleview (COM-001)\"] -->|generates| INV[\"BLINC Invoice\"]" }
```
