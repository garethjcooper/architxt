### Venn diagram syntax

Start with `venn-beta`.

- Sets: `setName["Label"]`.
- Unions of existing sets are created by concatenating set names: `AB["A and B"]` where `A` and `B` are defined sets.
- Text nodes: `textNode["annotation"]`.
- Sizes: `setName @ 100` or `AB @ 20` to set relative area.
- One declaration per line.
- No blank lines inside the Mermaid source.

Example:
```json
{ "type": "venn-beta", "content": "venn-beta\n  A[\"Systems\"]\n  B[\"Processes\"]\n  AB[\"Shared\"]" }
```
