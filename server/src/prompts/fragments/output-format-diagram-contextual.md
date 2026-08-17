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

## Mermaid syntax safety

The `content` field must be valid Mermaid syntax. Mermaid is strict about characters in labels and identifiers.

- Use `graph TD` or `graph LR` for flowcharts. Pick the direction that best matches the flow.
- Node IDs must be plain identifiers with no spaces, slashes, parentheses, brackets, quotes, colons, pipes, or special characters. Good: `ICMS`, `BillingSystem`, `MozartAPI`. Bad: `ICMS/API`, `Billing (system)`, `Mozart::API`.
- Every node label must be wrapped in double quotes. Good: `ICMS["Billing System"]`. Bad: `ICMS[Billing System]`.
- Inside quoted labels, do NOT use: `/`, `(`, `)`, `[`, `]`, `{`, `}`, `"`, `#`, `;`, `|`, `--`, or newlines.
- Replace `/` in prose with a space or hyphen: `rental/usage feed` → `rental usage feed` or `rental-usage-feed`.
- Remove or rewrite parentheses and brackets in labels: `(async)` → `async`, `[batch]` → `batch`, `foo(bar)` → `foo bar`.
- Labels may contain ASCII letters, digits, spaces, hyphens, periods, commas, and apostrophes only.
- One edge per line. No trailing comments, no inline CSS (`classDef`, `style`), no subgraphs.
- Do not put blank lines inside the Mermaid source.
- Do not wrap the `content` in Markdown fences or triple backticks; it must be the raw Mermaid source.

Example of a safe edge:
```json
{ "name": "Integration flow", "type": "graph", "content": "graph TD\n  ICMS[\"ICMS\"] -->|\"sends rental usage feed\"| BILL[\"Billing System\"]" }
```

```json
{ "name": "Order sequence", "type": "sequenceDiagram", "content": "Alice->>Bob: Hello\nBob-->>Alice: Hi" }
```

```json
{ "name": "System context", "type": "flowchart", "content": "flowchart TD\n  SV[\"Singleview (COM-001)\"] -->|generates| INV[\"BLINC Invoice\"]" }
```
