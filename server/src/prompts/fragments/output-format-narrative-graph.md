### Output format

Return a focused Markdown narrative first, then a graph section with this exact structure:

## ARCHITXT-GRAPH-DATA
```json
{"nodes": [...], "edges": [...]}
```

The heading must appear exactly as `## ARCHITXT-GRAPH-DATA` on its own line. The JSON graph object must follow immediately inside a json-fenced code block. Do not wrap the heading itself in a code fence.

The narrative must be derived from source material.
The graph must be derived from the narrative after the narrative is complete.
The graph must never influence the construction of the narrative.

If no graph is justified, return an empty graph object after the heading:

```json
{"nodes": [], "edges": []}
```

No Markdown commentary is allowed outside the JSON block after the `## ARCHITXT-GRAPH-DATA` heading.
