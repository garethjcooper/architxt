### Flowchart / graph diagram syntax

Start with `flowchart` or `graph`, followed by a direction: `TB`, `TD`, `BT`, `LR`, `RL`.

Nodes are declared by an id and a shape:

- `id1[Text]` — rectangle
- `id1(Rounded text)` — rounded rectangle
- `id1((Circular text))` — circle
- `id1{Diamond text}` — diamond / decision
- `id1[/Parallelogram text/]` — parallelogram
- `id1[\Trapezoid text\]` — trapezoid
- `id1{{Hexagon text}}` — hexagon
- `id1[[Subroutine text]]` — subroutine
- `id1[(Database text)]` — database/cylinder
- `id1((Double circle text))` — double circle

Arrows:

- `id1 --> id2` — solid arrow
- `id1 -.-> id2` — dotted arrow
- `id1 ==> id2` — thick arrow
- `id1 -- text --> id2` — labeled arrow
- `id1 -->|text| id2` — arrow label in pipe syntax
- `id1 --x id2` — arrow with cross
- `id1 --o id2` — circle arrowhead
- `id1 -> id2` — open arrowhead
- `id1 -->|id2` — async (stroke)

### Arrow-label quoting rule (MANDATORY)

For any arrow label written as `id1 -->|label| id2`, the label MUST be wrapped in double quotes if it contains any character other than letters, digits, single spaces, or hyphens. This includes parentheses `()`, brackets `[]`, braces `{}`, slashes `/`, backslashes `\`, commas, periods, ampersands, or pipe characters.

- Correct: `A -->|"IDoc payload (HTTPS/TLS)"| B`
- Correct: `A -->|"POST /convert (raw file bytes, target format)"| B`
- Correct: `A -->|simple payload| B`
- Wrong: `A -->|POST /convert (raw file bytes, target format)| B` — the unquoted `)` terminates the label and breaks the parser.
- Wrong: `A -->|IDoc payload (HTTPS/TLS)| B` — the unquoted `/` and `()` cause a parse error.

If the label itself contains a double-quote character, use single quotes to wrap it instead, or remove/replace the double quote. Never leave a label that needs quoting unquoted.

Subgraphs:

```text
subgraph title
    id1 --> id2
end
```

Example:

```json
{ "type": "flowchart", "content": "flowchart LR\n  A[\"Billing\"] --\u003e B(\"Rating\")\n  B --\u003e C{\"Valid?\"}\n  C --\u003e|Yes| D[\"Invoice\"]\n  C --\u003e|No| E[\"Reject\"]" }
```

In the example above, the `content` value contains real line breaks. After JSON serialization those line breaks become `\\n`; do not type the literal characters `\\n` in the source string.

Rules:
- Node IDs must be plain identifiers with no spaces, parentheses, brackets, braces, quotes, colons, slashes, or special characters. Labels go inside the shape brackets.
- Use `flowchart` for new diagrams; `graph` is the legacy alias.
- One node or edge per line.
- No blank lines inside the Mermaid source.
