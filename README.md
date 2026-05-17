# Kanecta

Kanecta is an open-source data platform designed from the ground up to be the connective tissue between humans, applications, and AI.

Every piece of information in Kanecta — a paragraph, a decision, a person, an image, a code snippet — is a first-class object with a globally unique ID, an explicit type, rich metadata, and typed relationships to other objects. These objects live as plain JSON files on disk, in a structure any text editor can browse and any AI can reason over directly.

## A data platform

Your data belongs to you. Kanecta stores everything locally in an open, human-readable file format (or a database that you control) with no lock-in and no central server. Items are uniquely addressable, linked, tagged, and queryable — structured enough to power applications, transparent enough to audit by hand. Because the format is just files, it will be readable decades from now regardless of what software exists.

## An AI bridge

Kanecta is built for the age of AI-augmented work. Every item has a stable UUID an agent can reference across sessions. Types and relationships are explicit so AI doesn't have to infer structure from prose. Decision logs capture not just *what* was decided but *why*, with alternatives considered — building institutional memory that compounds in value over time. Pull precisely the context you need into a conversation rather than replaying entire histories.

## An application platform

The same data powering your personal knowledge base can power a community website, a governance system, a team planning tool, or a financial dashboard. Kanecta ships with a growing collection of real-world apps built on the protocol — not demos, but production software used by real organisations. Build your own on top of the API, or extend an existing app.

## Quick start

```
# Install Node.js from nodejs.org, then:

npm install -g kanecta
kanecta      # <-- will guide you through setup
```

## Learn more

- [Specification](kanecta-specification/specification.md) — the data model and protocol rules
- [Vision](kanecta-vision/kanecta-vision.adoc) — philosophy, architecture, and design decisions
- [Roadmap](kanecta-roadmap/) — what's planned and why
- [Docs](kanecta-docs/) — full documentation

AGPL-3.0 licensed. Self-hosted.
