### Entity Relationship diagram syntax

Start with `erDiagram`.

- Entity names must be plain ASCII identifiers with no spaces, slashes, parentheses, brackets, quotes, colons, or special characters. Good: `CUSTOMER`, `ORDER`, `Singleview`. Bad: `Singleview (COM-001)`, `ICMS/API`.
- Relationship lines must use one of these four exact cardinality tokens on each side:
  - `||` exactly one
  - `|o` zero or one
  - `}o` zero or more
  - `}|` one or more
- Full relationship form: `ENTITY_A }o|--|| ENTITY_B : "label text"`.
- Dotted relationship (non-identifying): use `..` between the two sides: `ENTITY_A }o..o{ ENTITY_B : "optional"`.
- The label after `:` must be in double quotes if it contains spaces.
- Do NOT use flowchart syntax like `--o{`, `--||`, `-->`, `--|>`, `-.->`, or `--` inside `erDiagram`.
- One relationship per line.
- No blank lines inside the Mermaid source.

Example:
```json
{ "type": "erDiagram", "content": "erDiagram\n  Singleview }o|--|| Siebel : \"provides data to\"\n  Singleview }o|--|| ICMS : \"sends usage data\"" }
```
