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
- State names must be plain identifiers; put human-readable labels inside the braces or use the `as` alias syntax.
- One transition per line.
- No blank lines inside the Mermaid source.
