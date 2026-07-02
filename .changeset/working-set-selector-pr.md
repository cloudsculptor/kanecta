---
"@kanecta/api": minor
"@kanecta/studio": minor
---

Show live branch changes and merge branches from the Studio working-set selector.

The selector now surfaces the active working branch's pending changes and lets
you merge them into `main` (a local "pull request"):

- **API** — two endpoints back the feature:
  - `GET /working-sets/:name/branches/:branch/diff` returns the change counts
    (`{ branch, adds, edits, deletes }`) for a branch vs its upstream.
  - `POST /working-sets/:name/branches/:branch/merge` applies the branch's diff
    to `main`, removes the branch folder, and switches the working set back to
    `main`. Merging `main` into itself is rejected.
- **Studio** — the `WorkingSetSelector` shows live `+add ±edit −del` stats for
  the active working branch (hidden on `main`, which has nothing to diff), and
  the "Create Pull Request" action opens a `MergePullRequestDialog` that previews
  the diff and merges into `main`, invalidating item views on success. The
  action is disabled when the branch has no changes.
