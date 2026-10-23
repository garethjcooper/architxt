### Sequence diagram syntax

Start with `sequenceDiagram`.

Participants can be declared explicitly:

- `participant Alice`
- `participant Alice as Bob` — alias
- `actor Alice`
- `actor Alice as Bob`
- Special lifeline shapes: `boundary`, `control`, `entity`, `database`, `collections`, `queue`

Example declarations:

```text
sequenceDiagram
    participant Alice
    participant Bob
    actor John as John
```

Messages (arrows):

- `A->>B: text` — solid arrow
- `A-->>B: text` — dashed arrow
- `A->B: text` — thin solid arrow
- `A-->B: text` — thin dashed arrow
- `A->>>B: text` — solid arrow with filled arrowhead
- `A-->>>B: text` — dashed arrow with filled arrowhead
- `A->>B: text` — open arrowhead
- `A--xB: text` — async lost message
- `A->xB: text` — sync lost message
- `A->>>B: text` — filled arrowhead
- `A-->>>B: text` — dashed filled arrowhead

### Message-label quoting rule (MANDATORY)

For any message text after `:`, the text MUST be wrapped in double quotes if it contains any character other than letters, digits, single spaces, or hyphens. This includes parentheses `()`, brackets `[]`, braces `{}`, slashes `/`, backslashes `\`, commas, periods, ampersands, or pipe characters.

- Correct: `A->>B: "POST /convert (raw file bytes, target format)"`
- Correct: `A->>B: "IDoc payload (HTTPS/TLS)"`
- Correct: `A->>B: simple payload`
- Wrong: `A->>B: POST /convert (raw file bytes, target format)` — the unquoted `)` and `/` break the parser.
- Wrong: `A->>B: IDoc payload (HTTPS/TLS)` — the unquoted `/` and `()` cause a parse error.

If the message text itself contains a double-quote character, use single quotes to wrap it instead, or remove/replace the double quote. Never leave a message text that needs quoting unquoted.

Activations:

- `activate A`
- `deactivate A`

Fragments:

- `loop text ... end`
- `alt text ... else ... end`
- `opt text ... end`
- `par text ... and ... end`
- `rect rgb(255,0,0) ... end`

Notes:

- `Note over A,B: text`
- `Note left of A: text`
- `Note right of A: text`

Example:

```json
{ "type": "sequenceDiagram", "content": "sequenceDiagram\n  participant A as App\n  participant S as Server\n  A->>S: Request\n  activate S\n  S-->>A: Response\n  deactivate S" }
```

Rules:
- Participants are optional; if omitted, use the first bare id in a message as the participant name.
- Node labels should be plain display names followed by the canonical entity id in the form `Display Name example-type:EXAMPLE-001`. Do NOT use parentheses `()`, square brackets `[]`, or the narrative entity-reference format `[[Name (type:id)]]` inside Mermaid labels. The id must be a plain space-separated `type:id` suffix. Wrong: `Example System (EXAMPLE-001)` or `[[Example System (example-type:EXAMPLE-001)]]`. Right: `Example System example-type:EXAMPLE-001`. Do not put raw catalog references such as `EXT:EXT-ERP-001` or `A-C:XFR-ENG-001` inside node labels as plain text.
- Message text: if the provided context includes an existing contextual-graph or mental-model edge between the same two participants, reuse its exact `label` and `type` for the message. Only generate a new message when no such edge exists. Direction does not matter for this lookup.
- One message, declaration, activation, note, or fragment line per line.
- No blank lines inside the Mermaid source.
