### Class diagram syntax

Start with `classDiagram`.

- Class names must be plain ASCII identifiers with no spaces or special characters.
- Members go inside curly braces on their own lines:
  - Attributes: `+name: String`, `-secret: Number`
  - Methods: `+getName() String`, `+setName(name String)`
- Visibility characters: `+` public, `-` private, `#` protected, `~` package.
- Relationships:
  - Inheritance: `Animal <|-- Duck`
  - Composition: `Car *-- Wheel`
  - Aggregation: `Car o-- Wheel`
  - Association: `Student --> Course`
  - Dependency: `Student ..> Course`
  - Realization: `IPerson <|.. Student`
- Label a relationship with `: "label"` after the relationship.
- Multiplicity can be quoted: `"1" --> "0..*"`.
- No blank lines inside the Mermaid source.

Example:
```json
{ "type": "classDiagram", "content": "classDiagram\n  class Customer{\n    +id\n    +name\n  }\n  Customer --> Order : \"places\"" }
```
