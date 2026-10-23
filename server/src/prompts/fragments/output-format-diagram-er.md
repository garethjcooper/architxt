### Entity Relationship diagram syntax

Start with `erDiagram`.

- Entity names must be plain ASCII identifiers with no spaces, parentheses, brackets, quotes, colons, or slashes. Digits and underscores are allowed. Good: `CUSTOMER`, `ORDER`, `Singleview`. Bad: `Singleview (COM-001)`, `ICMS/API`.
- Relationship labels after `:` should name specific components plainly, using the form `Display Name example-type:EXAMPLE-001` when they refer to an entity, so downstream tools can resolve them. Do NOT use parentheses `()`, square brackets `[]`, or the narrative entity-reference format `[[Name (type:id)]]` inside Mermaid labels. The id must be a plain space-separated `type:id` suffix. The label must still be in double quotes if it contains spaces or any reserved characters.
- Relationship lines must use one of these exact cardinality tokens on each side:
  - `||` exactly one
  - `|o` zero or one
  - `}o` zero or more
  - `}|` one or more
  - `o{` zero or more (alias)
  - `|{` one or more (alias)
- Full relationship form: `ENTITY_A }o--|| ENTITY_B : "label text"`.
- Dotted relationship (non-identifying): `ENTITY_A }o..|| ENTITY_B : "optional"`.
- The label after `:` must be in double quotes if it contains spaces.
- Relationship labels: if the provided context includes an existing contextual-graph or mental-model edge between the same two entities, reuse its exact `label` and `type` for the relationship label. Only generate a new label when no such edge exists. Direction does not matter for this lookup.
- Do NOT use flowchart syntax like `--o{`, `--||`, `-->`, `--|>`, `-.->`, or `--` without a complete right-side token inside `erDiagram`.
- One relationship per line.
- No blank lines inside the Mermaid source.

Example:

```json
{ "type": "erDiagram", "content": "erDiagram\n  Singleview }o--|| Siebel : \"provides data to\"\n  Singleview }o--o{ ICMS : \"sends usage data\"" }
```
