### Sequence diagram syntax

Start with `sequenceDiagram`.

- Participants are declared with `participant A as "Display Name"`. Use `actor`, `boundary`, `control`, `entity`, `database`, `collections`, or `queue` instead of `participant` if the role fits.
- Actor/participant IDs must be plain ASCII identifiers with no spaces or special characters.
- Display names with spaces must be in double quotes: `participant A as "Order Service"`.
- Inside quoted names, do NOT use: `"`, `[`, `]`, `{`, `}`, `|`, `--`, or newlines.
- Message arrows:
  - `->>` solid arrow
  - `-->>` dashed arrow
  - `->>+` open activation
  - `->>-` close activation
  - `->>` with no activation for simple messages
- Message text follows the arrow: `A ->> B: "message text"`. Use double quotes if the text contains spaces.
- One message per line.
- No notes, loops, `alt`, `par`, `rect`, `critical`, `break`, `activate`, or `deactivate`.
- No blank lines inside the Mermaid source.

Example:
```json
{ "type": "sequenceDiagram", "content": "sequenceDiagram\n  participant A as \"Client\"\n  participant B as \"API\"\n  A->>B: \"request\"\n  B-->>A: \"response\"" }
```
