### Timeline diagram syntax

Start with `timeline`.

- Optional title: `title My Title`.
- Section headers: `section Section Name`.
- Event syntax: `time period : event description`.
- You may add a second colon and another event: `time period : event1 : event2`.
- Use double quotes around event text that contains special characters or colons.
- One event line per time period.
- No blank lines inside the Mermaid source.

Example:
```json
{ "type": "timeline", "content": "timeline\n  title Release history\n  section 2026\n    Q1 : \"Initial release\"\n    Q2 : \"API support\"" }
```
