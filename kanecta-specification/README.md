# @kanecta/specification

JSON schemas for the Kanecta datastore file format.

## Install

```sh
npm install @kanecta/specification
```

## Usage

```js
const typeSpec = require('@kanecta/specification/1.2.0/file-specs/type.json');
```

## File specs (1.2.0)

| File | Describes |
|------|-----------|
| `type.json` | `.kanecta/types/{shard1}/{shard2}/{uuid}/type.json` — custom type definition |
| `items.json` | `.kanecta/items/{shard1}/{shard2}/{uuid}/items.json` — item list file |
| `metadata.json` | `.kanecta/…/metadata.json` — item metadata |
| `meta.json` | `.kanecta/…/meta.json` — datastore meta |
