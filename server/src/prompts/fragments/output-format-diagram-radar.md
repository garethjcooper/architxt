### Radar diagram syntax

Start with `radar-beta`.

- Optional title: `title My Title`.
- Axis names must be plain ASCII identifiers. Wrap in double quotes if they contain spaces.
- Data series syntax: `axisName value, axisName value, ...`.
- You can label a series by prefixing with a name: `Series A: axis1 80, axis2 60`.
- Values must be numbers. Use consistent scale for all axes.
- One series per line.
- No blank lines inside the Mermaid source.

Example:
```json
{ "type": "radar-beta", "content": "radar-beta\n  title Capability scores\n  axis Performance 100\n  axis Reliability 100\n  Team A: Performance 80, Reliability 60" }
```
