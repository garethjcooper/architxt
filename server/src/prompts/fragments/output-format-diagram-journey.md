### User Journey diagram syntax

Start with `journey`.

- Sections group related tasks. Start a section with `section Section Name`.
- Task syntax: `Task name: <score>: <comma-separated actors>`.
- Score must be an integer between 0 and 5.
- Actor names must be plain ASCII identifiers with no spaces or special characters.
- One task per line.
- No blank lines inside the Mermaid source.

Example:
```json
{ "type": "journey", "content": "journey\n  title Customer checkout\n  section Browse\n    Find product: 5: Customer\n  section Buy\n    Pay: 3: Customer, Payment" }
```
