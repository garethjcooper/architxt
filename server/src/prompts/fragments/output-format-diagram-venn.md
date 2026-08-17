### Venn diagram syntax

Start with `venn-beta`.

- `set {id}["{label}"] (: {size})?` — declare a set. Size is optional.
- `union {id1},{id2}["{label}"] (: {size})?` — declare the intersection of two or more sets.
- `intersection` and `disjunction` are also valid keywords instead of `union`.
- Nested text nodes:
  ```
  set A["Frontend"]
    text A1["React"]
    text A2["Design Systems"]
  ```

Example:

```json
{ "type": "venn-beta", "content": "venn-beta\n  set A[\"Systems\"]\n  set B[\"Processes\"]\n  union A,B[\"Shared\"]" }
```

Rules:
- Do not declare plain identifiers without the `set` keyword.
- A union must reference declared set ids.
- One declaration per line.
- No blank lines inside the Mermaid source.
