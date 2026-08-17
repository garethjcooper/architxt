### Diagram generation rules

The `diagrams` envelope section must contain a list of diagram objects.

Each diagram must have:
- `name`: a short human-readable identifier for the diagram (used as its title/label when rendered).
- `type`: a valid Mermaid diagram type. Valid types are: `flowchart`, `graph`, `swimlane-beta`, `sequenceDiagram`, `classDiagram`, `stateDiagram-v2`, `erDiagram`, `journey`, `gantt`, `pie`, `timeline`, `radar-beta`, `architecture-beta`, `block`, `mindmap`, `venn-beta`.
- `content`: a single string of valid Mermaid diagram notation. Preserve newlines inside the string as `\n` so the envelope remains JSON-parseable.

Rules:
- Only emit a diagram when it is justified by the source material and requested by the active section directives.
- The `type` must match exactly one of the allowed keywords.
- Do not wrap the `content` in Markdown fences or triple backticks; it must be the raw Mermaid source.
- When the active sections do not include diagrams, return an empty `diagrams` array.
- Do not include entity catalog IDs or type prefixes such as `(Company:COM-001)` in visible labels unless they are inside a quoted label.

The detailed syntax for the requested diagram type is provided in the next section.
