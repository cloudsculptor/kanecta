# @kanecta/cloud

Kanecta's cloud storage adapter — the "bring your own database/S3" mode that `kanecta-lib` selects in place of `@kanecta/filesystem`.

`CloudAdapter` composes a `@kanecta/database` adapter (items, backed by Postgres) and a `@kanecta/s3` adapter (files, backed by any S3-compatible store) behind a single adapter interface, so the rest of the system doesn't need to know storage is split across two backends. See `kanecta-docs/architecture.adoc` for the full picture.

```js
const { CloudAdapter } = require('@kanecta/cloud');

const adapter = await CloudAdapter.open({ items: postgresAdapter, files: s3Adapter });
```

Status: scaffolding only — `@kanecta/database`/`@kanecta/postgres` and `@kanecta/s3` are still stubs, and `kanecta-lib` does not yet wire up REMOTE mode.
