### Diagram generation rules

The `diagrams` envelope section holds Mermaid diagrams. Populate it only when the diagrams section is active; otherwise leave it as an empty array `[]`.

Each bullet in `ARCHITXT_DIAGRAM_FOCUS` is a separate requested diagram. Emit exactly as many `diagrams` array items as there are non-empty bullets in `ARCHITXT_DIAGRAM_FOCUS`. Do not merge multiple diagram bullets into one array item, and do **not** create narrative entries for diagram sections. Diagrams belong only in `diagrams[]`.

For each `diagrams[]` item:
- `name`: the exact title shown in the focus bullet. If the bullet has a bold name (e.g. `- **Example Diagram** (flowchart) — ...`), use that exact bold text. **This MUST be the exact title provided via `#diagram-name` when one is present. Do not rename, paraphrase, or invent an alternative title.** If the bullet has no name, generate a short descriptive name (4–6 words) based on the diagram's content.
- `type`: a valid Mermaid diagram type taken from the bullet. Valid types are: `flowchart`, `graph`, `swimlane-beta`, `sequenceDiagram`, `classDiagram`, `stateDiagram-v2`, `erDiagram`, `journey`, `gantt`, `pie`, `timeline`, `radar-beta`, `architecture-beta`, `block`, `mindmap`, `venn-beta`.
- `content`: a single string of valid Mermaid diagram notation. Write the source with real line breaks (one node or edge per line). When the value is serialized to JSON, those line breaks will be encoded as `\\n`; do not type the literal characters `\\n` yourself.
- `evidence`: an array of Hindsight memory IDs that justify the diagram. **Every emitted diagram must include this field;** use an empty array only when the diagram has no source evidence. Evidence IDs must be the **full, exact** Hindsight memory IDs as they appear in the source material. Do not truncate, shorten, hash, abbreviate, or invent IDs. For example, if the source material lists a memory as `mem-abc123def4567890abcdef12`, emit that exact string; do not reduce it to `abc123de` or any other partial form.

Rules:
- Only emit a diagram when it is justified by the source material and requested by the active section directives.
- The `type` must match exactly one of the allowed keywords.
- Do not wrap the `content` in Markdown fences or triple backticks; it must be the raw Mermaid source.
- When the active sections do not include diagrams, return an empty `diagrams` array.
- Do not include entity catalog IDs or type prefixes such as `(Company:COM-001)` in visible labels.
- **No literal parentheses `( )` may appear inside any quoted or unquoted label, node text, message text, or relationship label.** Parentheses are reserved for Mermaid structural syntax only. If a concept naturally reads with a parenthetical, omit the parenthetical entirely or rephrase it without parentheses. For example, write `sends IDoc payloads`, not `sends IDoc payloads (IDoc)`; write `connects via HTTPS`, not `connects via HTTPS (client ID auth)`.
- Node labels must be plain display names only. Do not put catalog references such as `EXT:EXT-ERP-001` or `A-C:XFR-ENG-001` inside node labels.
- One node or edge per line. No blank lines inside the Mermaid source.
- Do not emit the literal two-character sequence `\\n` inside the content; always use an actual newline.
- Do not summarise a diagram's content in the `narratives[]` section. A diagram section is fully expressed by its own `diagrams[]` entry.

Example — when `ARCHITXT_DIAGRAM_FOCUS` is:
```
- **Example Diagram A** (flowchart) — Show a flowchart of the interactions between Example A and Example B.
- **Example Diagram B** (sequenceDiagram) — Show the payment sequence.
```

Emit exactly:
```json
{
  "diagrams": [
    { "name": "Example Diagram A", "type": "flowchart", "content": "flowchart LR\n  ...", "evidence": [] },
    { "name": "Example Diagram B", "type": "sequenceDiagram", "content": "sequenceDiagram\n  ...", "evidence": [] }
  ]
}
```

A section requested as a diagram must appear only in `diagrams[]`, not in `narratives[]`.

### Arrow and message label quoting rule (MANDATORY)

Mermaid arrow labels and sequence message labels are terminated by the first unquoted `)`, `]`, `}`, `/`, pipe `|`, or similar punctuation. To prevent parse errors, any label or message text that contains a character other than letters, digits, single spaces, or hyphens MUST be wrapped in double quotes.

For flowchart and block diagrams, write arrow labels as `a -->|"POST /convert (raw file bytes, target format)"| b`. For sequence diagrams, write messages as `A->>B: "POST /convert (raw file bytes, target format)"`. For ER diagrams, write relationship labels as `ENTITY_A }o--|| ENTITY_B : "provides data (HTTPS/TLS)"`.

If the text contains a double quote, wrap it in single quotes instead, or remove/replace the double quote. Never leave a label that needs quoting unquoted.
