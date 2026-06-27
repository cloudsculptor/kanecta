# @kanecta/specification

JSON schemas for the Kanecta datastore file format.

Each version of the spec lives in its own directory (e.g. `1.2.0/`). The package always exports the schemas matching its own version — bump `package.json` version and add the new directory to ship a new spec version.

## Install

```sh
npm install @kanecta/specification
```

## Usage

```js
const spec = require('@kanecta/specification');

spec.version   // e.g. "1.4.0"
spec.type      // JSON schema for .kanecta/types/{shard1}/{shard2}/{uuid}/type.json
spec.items     // JSON schema for .kanecta/items/{shard1}/{shard2}/{uuid}/items.json
spec.metadata  // JSON schema for .kanecta/…/metadata.json
// spec.meta is not exported — meta.json is a cache derived from metadata.json + type.json, see 1.4.0/file-specs/meta.json.md
```

## Versioning

| Directory | Describes |
|-----------|-----------|
| `1.2.0/`  | Previous spec |
| `1.4.0/`  | Current spec |

To cut a new version: copy and paste the latest spec directory and modify the spec files as needed, then bump `version` in `package.json` to match.
