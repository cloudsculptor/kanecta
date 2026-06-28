# meta.json

**Location:** `.kanecta/data/{shard1}/{shard2}/{uuid}/meta.json`

`meta.json` is a **denormalized display cache** derived from two sources:

- The type definition's [metadata.json](metadata.json) — spread directly onto this file
- The type definition's [type.json](type.json) — `meta.icon` is extracted and stored here

It is written when a typed object item is created or its `typeId` changes. Its purpose is fast display: the item's type name and icon are available without looking up the type definition on every read.

## How it is produced

```js
{ ...typeMeta, type: 'object', ...(icon ? { icon } : {}) }
```

Where `typeMeta` is the type's `metadata.json` and `icon` comes from `type.json`'s `meta.icon` field.

The `type` field is always overridden to `"object"` (the type definition record's own value is `"type"`).

## Rules

- Only present on items where `metadata.json` has `type: "object"` and a non-null `typeId`.
- Has the same fields as [metadata.json](metadata.json), plus an optional `icon` string.
- This file is a cache — it can be regenerated from the type definition at any time.
- Not authoritative: if the type definition changes, this file may become stale until the item is next written.
