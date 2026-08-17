### Timeline diagram syntax

Start with `timeline`.

- `title {text}` — optional title.
- `section {name}` — groups time periods.
- `{time period} : {event}` or `{time period} : {event1} : {event2} : ...` — events in a period.

Example:

```json
{ "type": "timeline", "content": "timeline\n  title Product history\n  section 2024\n    Q1 : Prototype\n    Q2 : Alpha\n  section 2025\n    Q1 : Beta\n    Q2 : GA" }
```

Rules:
- Use `section` to group periods.
- One `section` header or period line per line.
- No blank lines inside the Mermaid source.
