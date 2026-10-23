### State diagram syntax

Start with `stateDiagram-v2`. Use `stateDiagram` only for legacy diagrams.

States:

- `stateName` — simple state
- `stateName : label` — state with a label
- `[*]` — start/end pseudo-state
- `state "Label" as stateName` — alias a long label to an id
- `state stateName { ... }` — composite / nested state

Transitions:

- `[*] --> stateName` — initial transition
- `stateA --> stateB` — transition
- `stateA --> stateB : event` — labeled transition
- `stateA --> stateB : event [guard] / action`

Choice / fork:

- `state choiceName <<choice>>`
- `state forkName <<fork>>`
- `state joinName <<join>>`

Concurrency:

```text
state Active {
  [*] --> NumLockOff
  NumLockOff --> NumLockOn : EvNumLockPressed
  --
  [*] --> CapsLockOff
  CapsLockOff --> CapsLockOn : EvCapsLockPressed
}
```

Example:

```json
{ "type": "stateDiagram-v2", "content": "stateDiagram-v2\n  [*] --\u003e Idle\n  Idle --\u003e Running : start\n  Running --\u003e Idle : stop\n  Running --\u003e Error : fail\n  Error --\u003e [*]" }
```

Rules:
- Transition event labels: if the provided context includes an existing contextual-graph or mental-model edge between the same two states, reuse its exact `label` and `type` for the transition event. Only generate a new event label when no such edge exists. Direction does not matter for this lookup.
- State names must be plain identifiers; put human-readable labels inside the braces or use the `as` alias syntax.
- Node labels should be plain display names followed by the canonical entity id in the form `Display Name example-type:EXAMPLE-001`. Do NOT use parentheses `()`, square brackets `[]`, or the narrative entity-reference format `[[Name (type:id)]]` inside Mermaid labels. The id must be a plain space-separated `type:id` suffix. Wrong: `Example System (EXAMPLE-001)` or `[[Example System (example-type:EXAMPLE-001)]]`. Right: `Example System example-type:EXAMPLE-001`. Do not put raw catalog references such as `EXT:EXT-ERP-001` or `A-C:XFR-ENG-001` inside node labels as plain text.
- One transition per line.
- No blank lines inside the Mermaid source.
