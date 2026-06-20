# Git-like Sync Model for Kanecta

**Status:** Design direction — not yet settled

---

## The idea

Give users the full power of the Git mental model, but applied to Kanecta datastores rather than files. The goal is not to build another Git — it is to give knowledge-graph workers the same fluency and safety that developers have when working with code: branch freely, experiment locally, share deliberately, merge with confidence.

---

## Core concepts

### Remotes

A remote is any reachable Kanecta datastore that the local workspace can sync with. A workspace can have multiple remotes — just like a Git repo can have `origin`, `upstream`, and others.

Examples:
- `origin` — the team's shared DigitalOcean Postgres instance
- `linz` — the organisation's internal Kanecta server
- `personal` — a second private cloud workspace

Remotes are named, configured in the workspace config, and interacted with via explicit push/pull/merge commands — never transparently in the background.

### Branches (local datastores)

Multiple local datastores within a workspace correspond to branches. Switching between them is equivalent to `git checkout`. Each local datastore is a full, independent copy of the knowledge graph — not a thin ref.

Examples:
- `main` — the local mirror of the primary remote
- `linz-onboarding` — a local branch scoped to current onboarding work
- `experiment/ai-tagging` — a local scratch branch for trying things

### Operations

| Git operation | Kanecta equivalent |
|---|---|
| `git clone` | Copy a remote datastore into a new local datastore |
| `git pull` | Fetch changes from a remote and merge into the current local datastore |
| `git push` | Send local changes to a remote for review / direct merge |
| `git branch` | Create a new local datastore |
| `git checkout` | Switch the active local datastore |
| `git diff` | Show ADD / EDIT / DELETE changes between two datastores |
| `git merge` | Merge changes from one datastore into another |
| `git status` | Show what has changed locally since last sync with remote |
| `git log` | Show item history / activity log |
| `git stash` | Not yet considered |

### Merge

Merge is the hardest part. Unlike file diff (line-by-line), Kanecta merge operates at item level:

- **ADD** — item exists in source, not in target → safe to apply
- **DELETE** — item removed in source → show subscribers (items that link to it) before applying
- **EDIT** — item changed in both source and target → field-level diff, conflict if same field changed both sides
- **CONFLICT** — same field changed differently in both datastores → requires human resolution

The Studio sync view (planned for v1.4.0) is the UI surface for merge operations. It shows the diff and lets the user accept, reject, or resolve each change before committing.

---

## What this is not

- **Not transparent sync.** Kanecta will never silently merge in the background. Every sync is explicit and inspectable.
- **Not eventual consistency.** The local datastore is the source of truth for work in progress. Remote is the shared source of truth. They diverge intentionally and reconcile on demand.
- **Not a Git wrapper.** The implementation uses Kanecta's own item model, history, and content_hash — not Git internals. The Git analogy is UX and mental model, not architecture.

---

## Relationship to v1.4.0

v1.4.0 lays the foundation:
- `content_hash` on every item (settled — see decision #3) enables efficient change detection between datastores
- `@kanecta/datastore-utils` owns `copyDatastore` and `mergeDatastore` — the core operations
- The Studio sync view shows the diff before merge

Full multi-remote and multi-branch UX comes in a later version. v1.4.0 targets the single-remote, single-branch case: one local SQLite+filesystem datastore syncing with one DigitalOcean Postgres remote.

---

## Open questions

- How are branch names stored? In the workspace config, in the datastore's metadata, or both?
- Can items have per-remote visibility (public to `origin`, private to `personal`)?
- What is the equivalent of `.gitignore` — items or subtrees excluded from push?
- How does merge handle relationship items where one end was deleted in one branch?
- Is there a fast-forward equivalent (remote has no divergent changes, so local can just apply)?
