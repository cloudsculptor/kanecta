# system-items

**Seed items the platform depends on.** These are ordinary (non-`type`) **items** —
*instances* — that Kanecta's own logic assumes already exist in a datastore. They
ship with the spec version that needs them and are **seeded into every datastore on
init**, alongside the built-in type definitions.

This is *not* a template library and *not* a "useful set of examples." Everything in
here is a **hard dependency**: leave it out and the platform is broken.

## Why they ship with the spec — "soft-coding"

Kanecta is progressively *soft-coded*: things once hard-coded into the front and back
end become first-class items the platform boots against. Built-in **types** were the
first step — a datastore is unusable without them. `system-items` is the same idea for
**instances**: some items must exist for core logic to work, so they ship with the spec
version that requires them.

They live *inside* the spec (`<spec-version>/system-items`) precisely because they are
**version-coupled** — each spec version ships exactly the seed items it needs. Consumers
resolve this folder through the specification package's current version, never a
hard-coded version string.

## What lives here

- **Built-in licences** — the `licence` items that every item's `meta.license` resolves
  to (default: *All Rights Reserved*). Every item carries a `meta.license` UUID that must
  point at a real `licence` item, so these must exist in every datastore. (Instances of
  the built-in `licence` type.)

## How this differs from its neighbours

| Location | What it holds | Does the platform depend on it? |
|---|---|---|
| `built-in-types/` | Type **definitions** the engine references | Yes — structural |
| `system-items/` (here) | Non-type **instances** the engine assumes exist | Yes — seeded on init |
| `kanecta-types` (separate repo) | Tier-3 generic type **library** (Schema.org, …) | No — opt-in; nothing depends on them |
