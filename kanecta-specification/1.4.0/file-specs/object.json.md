# object.json

**Location:** `.kanecta/data/{shard1}/{shard2}/{uuid}/object.json`

`object.json` is an **instance** of the JSON Schema defined in [type.json](type.json).

It stores the field values for one specific typed item. Its shape is not fixed — it is whatever the `jsonSchema.properties` of the item's type definition declares. The item's `typeId` (in `metadata.json`) points to the type definition whose `jsonSchema` validates this file.

## Example

Given a type definition (`type.json`) with:

```json
{
  "jsonSchema": {
    "title": "Person",
    "properties": {
      "name": { "type": "string" },
      "born": { "type": "string", "format": "date" }
    },
    "required": ["name"]
  }
}
```

The corresponding `object.json` for a Person item would be:

```json
{
  "name": "Richie Thomas",
  "born": "1990-01-01"
}
```

## Rules

- Only present on items where `metadata.json` has `type: "object"` and a non-null `typeId`.
- The content must be a JSON object (never an array or primitive).
- Field names and value types must conform to the `jsonSchema` of the referenced type definition.
- No file-level JSON Schema is defined for `object.json` itself — validation is delegated to the per-type `jsonSchema`.
