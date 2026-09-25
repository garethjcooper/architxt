### Output section mapping

Each requested section in the directives above maps to exactly one output array or object. A section requested as one type must not appear as any other type (narrative, graph, table, diagram) unless it was explicitly requested as multiple types.

- `ARCHITXT_NARRATIVE_FOCUS` bullets → emit one item in `narratives[]` per bullet.
- `ARCHITXT_GRAPH_FOCUS` bullets → emit **one** `graph` object for the **first** graph bullet. Additional graph bullets are intentionally ignored; do not write prose about them.
- `ARCHITXT_TABLE_FOCUS` bullets → emit one item in `tables[]` per bullet.
- `ARCHITXT_DIAGRAM_FOCUS` bullets → emit one item in `diagrams[]` per bullet.

A table, graph, or diagram section is already expressed in its own structured form. You must NOT create extra `narratives[]` entries that merely describe or summarise table, graph, or diagram sections.

If a requested section name is the same across types (for example a table named "Example Connection Details" and a diagram also named "Example Connection Details"), each type still produces its own structured output; do not merge them and do not produce a narrative entry for that name.

Before returning, verify:
1. `narratives[]` contains only sections requested as narratives.
2. `graph` contains only the single requested graph title, if any.
3. `tables[]` contains only sections requested as tables.
4. `diagrams[]` contains only sections requested as diagrams.
5. No requested section appears in more than one envelope bucket.
