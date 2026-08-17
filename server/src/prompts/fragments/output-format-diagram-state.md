### State diagram syntax

Start with `stateDiagram-v2`. Do not use `stateDiagram`.

- State names must be plain ASCII identifiers. If a state name contains spaces, wrap it in double quotes: `state "Idle State" as idle`.
- Start/end states: `[*]`.
- Transitions: `idle --> active`.
- Composite state: `state Active { active --> waiting }`.
- Choice: `state choice <<choice>>`.
- Fork/join: `state fork <<fork>>`.
- One transition per line.
- No blank lines inside the Mermaid source.

Example:
```json
{ "type": "stateDiagram-v2", "content": "stateDiagram-v2\n  [*] --> Idle\n  Idle --> Active : \"start\"\n  Active --> [*]" }
```
