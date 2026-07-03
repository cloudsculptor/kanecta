---
"@kanecta/specification": minor
---

Document the type-tier placement rule and the kanecta-types library in the 1.4.0 spec.

Adds two sections to `specification.adoc`: (1) *Type tiers* — the reference-based
rule for where a type lives (core = referenced by generic/core logic, seeded
everywhere; app = referenced by application/component logic, manifested by that
component; library/user = referenced by no hardcoded logic), generalising the
existing built-in-types principle. (2) *The kanecta-types Library* — a versioned,
curated library of generic reusable types derived from public ontologies
(Schema.org etc.) with deterministic UUIDv5 identity from the source URI,
ontology→flat-linked-type decomposition, derived (not stored) sqlSchema, and its
role as the corpus behind type reuse (search existing types + object counts before
minting new ones).
