### Entity Relationship diagram syntax

Start with `erDiagram`.

- Entity names must be plain ASCII identifiers with no spaces, parentheses, brackets, quotes, colons, or slashes. Digits and underscores are allowed. Good: `CUSTOMER`, `Singleview`, `RetrieveCustomerProfileV1`, `ICMS_API`. Bad: `Singleview (COM-001)`, `ICMS/API`, `Retrieve Customer Profile`.
- A relationship line has exactly this shape: `LEFT_TOKEN--RIGHT_TOKEN` or `LEFT_TOKEN..RIGHT_TOKEN`.
- Each of `LEFT_TOKEN` and `RIGHT_TOKEN` must be one of these six exact tokens:
  - `||` exactly one
  - `|o` zero or one
  - `}o` zero or more
  - `}|` one or more
  - `o{` zero or more (open-shape variant)
  - `|{` one or more (open-shape variant)
- Valid examples:
  - `Singleview }o--|| Siebel : "provides data to"`
  - `Singleview ||--o{ RetrieveCustomerProfileV1 : "provides data to"`
  - `Siebel }|..|{ Singleview : "receives usage data from"`
- `--` means an identifying relationship; `..` means a non-identifying relationship.
- The label after `:` must be in double quotes if it contains spaces; a single word may be unquoted.
- Do NOT write partial or combined forms such as `}o|--`, `}o|--||`, `--||`, or `-->`. These will fail to parse.
- One relationship per line.
- No blank lines inside the Mermaid source.

Example:
```json
{ "type": "erDiagram", "content": "erDiagram\n  Singleview }o--|| Siebel : \"provides data to\"\n  Singleview ||--o{ RetrieveCustomerProfileV1 : \"provides data to\"" }
```
