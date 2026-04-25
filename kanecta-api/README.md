# kanecta-api

HTTP API for the Kanecta data store.

## Setup

```bash
npm install
```

## Running in dev mode

```bash
npm start
```

The server listens on port 3000 by default. Override with the `PORT` env var:

```bash
PORT=4000 npm start
```

By default the API resolves the data store relative to this directory. Point it elsewhere with `KANECTA_DATASTORE`:

```bash
KANECTA_DATASTORE=/path/to/your/datastore npm start
```

## Endpoints

### `GET /:id`

Returns the metadata for the item with the given UUID.

```
GET /f1a00002-b45e-4c3d-9e7f-000000000001
```

```json
{
  "id": "f1a00002-b45e-4c3d-9e7f-000000000001",
  "parentId": "f1a00001-b45e-4c3d-9e7f-000000000001",
  "value": "Clarify",
  "type": "string",
  ...
}
```

**Responses**

| Status | Meaning |
|--------|---------|
| 200 | Item found — body is the metadata JSON |
| 400 | ID is not a valid UUID |
| 404 | No item exists with that ID |

## Running tests

```bash
npm test
```
