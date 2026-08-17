### User Journey diagram syntax

Start with `journey`.

A journey diagram has sections; each section contains tasks with a score and actors.

Syntax:

```text
journey
    title My working day
    section Go to work
      Make tea: 5: Me
      Go upstairs: 3: Me
      Do work: 1: Me, Cat
```

- `title {text}` — optional title.
- `section {name}` — begins a new section.
- `{Task name}: {score}: {actor1}, {actor2}, ...` — a task.
- Score is an integer from 0 to 5, where 5 is the most positive.

Example:

```json
{ "type": "journey", "content": "journey\n  title Customer onboarding\n  section Discovery\n    Visit website: 4: Customer\n    Read docs: 3: Customer\n  section Setup\n    Create account: 5: Customer\n    Configure billing: 2: Customer, Support" }
```

Rules:
- Every task must end with a score and at least one actor.
- One `section` or task per line.
- No blank lines inside the Mermaid source.
