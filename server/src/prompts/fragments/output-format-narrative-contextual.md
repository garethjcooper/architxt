### Narrative generation rules

The `narratives` envelope section holds human-readable Markdown prose. Populate it only when the narrative section is active; otherwise leave it as an empty array `[]`.

**Exact title for this narrative:** `{{ARCHITXT_NARRATIVE_NAME}}`. If empty, generate a short descriptive name (4–6 words) based on the content; otherwise use the exact title shown above with no changes.

Each narrative entry has:
- `narrative_name`: the short title/label for that narrative section. **This MUST be the exact title provided via `#narrative-name` when one is present. Do not rename, paraphrase, or invent an alternative title.**
- `narrative`: clean Markdown prose with paragraphs, or an empty string when there is nothing to say. Do NOT inline evidence IDs, citations, bracketed references such as `【...】`, parenthesized UUIDs such as `(uuid-here)`, or any other source markers inside the prose. Evidence belongs only in the `evidence` array.
- `evidence`: an array of Hindsight memory IDs backing the section. Use an empty array when the section has no source evidence.
