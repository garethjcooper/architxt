### Gantt diagram syntax

Start with `gantt`.

- Optional date format: `dateFormat YYYY-MM-DD` (place before tasks).
- Optional title: `title My Title`.
- Sections group tasks: `section Section Name`.
- Task syntax: `Task description : status, startDate, durationOrEndDate`.
- Status values: `done`, `active`, `crit`, or omit for default.
- Date formats: `YYYY-MM-DD`, `after taskId`, or durations like `3d`, `1w`, `2m`.
- One task per line.
- No blank lines inside the Mermaid source.

Example:
```json
{ "type": "gantt", "content": "gantt\n  dateFormat YYYY-MM-DD\n  title Project plan\n  section Build\n    Foundation :done, 2026-01-01, 7d\n    Walls :active, after Foundation, 5d" }
```
