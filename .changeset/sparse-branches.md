---
"@kanecta/sqlite-fs": minor
"@kanecta/lib": minor
"@kanecta/api": minor
---

Add sparse branches to the filesystem storage engine.

A branch can now be created with `fill: 'sparse'` and an `upstream`. Unlike a
full branch (a recursive copy of its base), a sparse branch stores only its own
changes in `items/` and reads everything else through from its upstream branch:

- **adds/edits** are ordinary `item.json` files written locally (an edit
  materialises the upstream item on first write);
- **deletes** are tombstone `item.json` files (`{ tombstone: true }`) that mask
  the upstream item on read and apply the delete on merge;
- the branch's `index.db` stays 100% derived — it is projected from the local
  `items/` overlaid on the upstream (local full branch), so all existing
  queries (get/children/tree/loadAll/search) work unchanged.

`branchDiff` and `mergeBranchLocally` are sparse-aware: the diff is exactly the
local overlay (inherited items are never reported as deletes), and merge applies
those adds/edits/deletes to the upstream.

Upstream may be a local full branch (`upstream: { branch }`, tracked and
testable today) or a remote (`upstream: { remote, branch }`, reserved for
query-time federation — not yet wired). `Datastore.createBranch(name, { fill,
upstream })` and `POST /working-sets/:name/branches` (`fill`, `upstream` body
fields) expose it; `Datastore.mergeBranchLocally(name)` is now surfaced on the
facade.
