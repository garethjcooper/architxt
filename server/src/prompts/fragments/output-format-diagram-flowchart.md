### Flowchart / graph syntax

Use `flowchart TD`, `flowchart LR`, `flowchart BT`, or `flowchart RL`. `graph TD` is an alias for `flowchart TD`.

- Node IDs must be plain ASCII identifiers with no spaces, slashes, parentheses, brackets, quotes, colons, pipes, or special characters. Good: `A`, `ICMS`, `MozartAPI`. Bad: `ICMS/API`, `Billing (system)`, `Mozart::API`.
- Node labels must be wrapped in double quotes: `A["Billing System"]`.
- Inside quoted labels, do NOT use: `/`, `(`, `)`, `[`, `]`, `{`, `}`, `"`, `#`, `;`, `|`, `--`, or newlines.
- Replace `/` with a space or hyphen: `rental/usage feed` → `rental usage feed`.
- Replace parentheses and brackets with plain text: `(async)` → `async`, `[batch]` → `batch`.
- Directed arrow: `-->` or `==>` or `--.->`. Label an arrow with `A -->|"sends feed"| B`.
- One edge per line.
- No `classDef`, `style`, `subgraph`, `click`, `callBack`, or comments.
- No blank lines inside the Mermaid source.

Example:
```json
{ "type": "flowchart", "content": "flowchart TD\n  A[\"ICMS\"] -->|\"sends rental usage feed\"| B[\"Billing System\"]" }
```
