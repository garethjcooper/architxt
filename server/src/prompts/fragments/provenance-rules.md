### Provenance rules

Do not set `provenance` on edges. The system will derive it after parsing:

- If at least one endpoint id starts with `found:`, provenance becomes `discovered`.
- Otherwise provenance is set by the producing activity (`known` or `inferred`).

Valid provenance values are only: `known`, `discovered`, `inferred`. `found:` is a node-id prefix, not a provenance value.
