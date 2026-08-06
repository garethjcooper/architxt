### Provenance rules

Do not set `provenance` on edges. The system will derive it after parsing:

- If at least one endpoint node has `"provenance": "discovered"`, provenance becomes `discovered`.
- Otherwise provenance is set by the producing activity (`known` or `inferred`).

Valid provenance values are only: `known`, `discovered`, `inferred`.
