---
"@kanecta/studio": patch
---

Fix the Storybook build (and unblock CI) by adding two missing stylesheets.

`ActivityFeed` and `ConflictList` imported `./ActivityFeed.scss` and
`./ConflictList.scss`, which were never committed, so `storybook build` failed
with `UNRESOLVED_IMPORT`. Both stylesheets are added following the MissionControl
folder's `Block-element` / `--modifier` convention. Also fixes a latent bug in
`ActivityFeed` where the operation modifier class was a literal
`--{event.operation}` instead of an interpolated `--created` / `--modified`.
