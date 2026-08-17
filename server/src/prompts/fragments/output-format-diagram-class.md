### Class diagram syntax

Start with `classDiagram`.

Define a class:

- `class ClassName`
- `class ClassName["Label with spaces"]`
- ``class `Class Name!` `` — backtick-wrapped names for special characters
- Backtick names can contain spaces and symbols.

Class members:

```text
class BankAccount{
    +String owner
    +BigDecimal balance
    +deposit(amount)
    +withdrawal(amount)
}
```

- `+` public, `-` private, `#` protected, `~` package/internal
- `attribute: type`
- `method(arg)` or `method(arg) returnType`
- Generic types use tildes: `List~int~`

Relationships:

- `A <|-- B` — inheritance (B extends A)
- `A *-- B` — composition (B is part of A)
- `A o-- B` — aggregation (B belongs to A)
- `A --> B` — association
- `A -- B` — link
- `A <.. B` — dependency
- `A <|.. B` — realization (implements)
- `A .. B` — dashed link
- `A <|--|> B` — two-way relation
- Add a label: `A --|> B : implements`

Lollipop interfaces:

- `ClassName --() InterfaceName`
- `()-- ClassName`

Namespaces:

```text
namespace BaseShapes {
    class Triangle
    class Rectangle {
      double width
      double height
    }
}
```

Example:

```json
{ "type": "classDiagram", "content": "classDiagram\n  Animal <|-- Duck\n  Animal : +int age\n  Animal : +isMammal()\n  class Duck {\n    +String beakColor\n    +swim()\n  }" }
```

Rules:
- Class names must be plain identifiers unless wrapped in backticks.
- One class, member, or relationship per line.
- No blank lines inside the Mermaid source.
