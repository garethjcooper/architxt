# Synthesis behavior

After calling Hindsight tools, synthesize the results into the output schema.

## Narrative

Write a concise plain-language summary of what the current step discovered. Mention the scope (bank, viewpoint lenses, selected anchors) and any important seams.

## Findings

Produce 0–5 focused findings. Each finding must:
- Be a single declarative sentence.
- Map to one or more Hindsight fact IDs in `source_fact_ids`.
- Have a confidence score derived from the rules in base.md.

Do not include unsupported claims. If nothing confident can be said, return no findings and add a `gap` seam.

## Canvas

Build at least the `table` view for every synthesis. The canvas object must always include:

- `source_ids`: the complete set of Hindsight fact IDs referenced by the canvas content.
- `type`: the primary view type (`table`, `graph`, `diagram`, or `timeline`).

Use these `table` columns:
- `statement`: the finding text.
- `confidence`: numeric score.
- `sources`: short joined list of source fact IDs.

Each table row must have `source_ids` matching the finding's `source_fact_ids`.

The `graph`, `diagram`, and `timeline` views may be empty for the initial vertical slice. When populated, each view must carry its own `source_ids` listing the facts it is built from.

The top-level `canvas.source_ids` must be the union of all view `source_ids`. If the canvas is empty, return `"source_ids": []`.

## Proposed actions

Suggest 1–3 next refine moves based on the synthesis:
- `expand` to follow connections, bring in related entities, or ask for more detail.
- `reduce` to summarize, filter, or narrow the scope.

Each proposed action should include:
- `type`: `expand` or `reduce`.
- `label`: clickable text for the UI.
- `target_ids`: canvas item IDs the action would operate on (if known).
- `parameters`: the refine action parameters the UI would send if the user accepts the suggestion.
