### Radar diagram syntax

Start with `radar-beta`.

- `title {text}` — optional title.
- `axis {id}["{label}"]` — one axis. Repeat once per spoke, or list axes on a single `axis` line separated by commas: `axis a["A"], b["B"], c["C"]`.
- `curve {id}["{label}"]{ {value1}, {value2}, ... }` — a data curve matching the axes in order.
- Curves can also use named values: `curve x["X"]{ axis1: 30, axis2: 20, axis3: 10 }`.
- `max {number}` and `min {number}` — optional scale limits.
- `graticule circle|polygon` — optional grid shape.
- `ticks {number}` — optional tick count.
- `showLegend true` — optional legend.

Example:

```json
{ "type": "radar-beta", "content": "radar-beta\n  title \"Capability scores\"\n  axis performance[\"Performance\"], reliability[\"Reliability\"], security[\"Security\"]\n  curve teamA[\"Team A\"]{80, 60, 90}\n  curve teamB[\"Team B\"]{70, 75, 85}\n  max 100\n  min 0" }
```

Rules:
- Do not put a scale number directly after an axis label (e.g. `axis Performance 100` is invalid).
- Each curve must have the same number of values as axes.
- One declaration per line.
- No blank lines inside the Mermaid source.
