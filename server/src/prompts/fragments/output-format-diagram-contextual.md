### Diagram generation rules

The `diagrams` envelope section holds Mermaid diagrams. Populate it only when the diagrams section is active; otherwise leave it as an empty array `[]`.

**Exact title for this diagram:** `{{ARCHITXT_DIAGRAM_NAME}}`. If empty, generate a short descriptive name (4–6 words) based on the content; otherwise use the exact title shown above with no changes.

Each diagram must have:
- `name`: a short human-readable identifier for the diagram (used as its title/label when rendered). **This MUST be the exact title provided via `#diagram-name` when one is present. Do not rename, paraphrase, or invent an alternative title.** If no name is provided, generate a short descriptive name (4–6 words) based on the diagram's content.
- `type`: a valid Mermaid diagram type. Valid types are: `flowchart`, `graph`, `swimlane-beta`, `sequenceDiagram`, `classDiagram`, `stateDiagram-v2`, `erDiagram`, `journey`, `gantt`, `pie`, `timeline`, `radar-beta`, `architecture-beta`, `block`, `mindmap`, `venn-beta`.
- `content`: a single string of valid Mermaid diagram notation. Write the source with real line breaks (one node or edge per line). When the value is serialized to JSON, those line breaks will be encoded as `\\n`; do not type the literal characters `\\n` yourself.
- `evidence`: an array of Hindsight memory IDs that justify the diagram. Every emitted diagram must include this field; use an empty array only when the diagram has no source evidence.

Rules:
- Only emit a diagram when it is justified by the source material and requested by the active section directives.
- The `type` must match exactly one of the allowed keywords.
- Do not wrap the `content` in Markdown fences or triple backticks; it must be the raw Mermaid source.
- When the active sections do not include diagrams, return an empty `diagrams` array.
- Do not include entity catalog IDs or type prefixes such as `(Company:COM-001)` in visible labels unless they are inside a quoted label.
- One node or edge per line. No blank lines inside the Mermaid source.
- Do not emit the literal two-character sequence `\\n` inside the content; always use an actual newline.
