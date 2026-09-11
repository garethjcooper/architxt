### Gantt diagram syntax

Start with `gantt`.

- `title {text}` — optional title.
- `dateFormat {format}` — sets how dates are parsed, e.g. `YYYY-MM-DD`.
- `excludes weekends` — optional; omits Saturdays and Sundays.
- `section {name}` — begins a task section.
- `{taskName} : {status}, {id}, {startDate}, {duration}` — a task line.
  - `status` can be `done`, `active`, `crit`, or omitted.
  - `id` is an optional reference for dependencies.
  - `startDate` can be an absolute date or `after {id}`.
  - `duration` like `1d`, `2w`, `3m`.

Example:

```json
{ "type": "gantt", "content": "gantt\n  title Project plan\n  dateFormat YYYY-MM-DD\n  section Design\n    Draft :done, a1, 2026-01-01, 5d\n    Review :active, a2, after a1, 3d\n  section Build\n    Code :crit, b1, after a2, 10d" }
```

Rules:
- Use the exact colon-separated task syntax shown above.
- One `section` or task per line.
- No blank lines inside the Mermaid source.
