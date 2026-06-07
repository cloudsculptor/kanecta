# kanecta-api

HTTP REST API for the Kanecta datastore.

## Setup

```bash
npm install
```

`@kanecta/lib` is referenced as `"file:../kanecta-lib"` — do not change this to a version range for local development.

## Running

```bash
KANECTA_DATASTORE=~/.kanecta npm start
```

The server listens on **port 3001** by default. Override with `PORT`:

```bash
PORT=4000 npm start
```

## Authentication

Every route requires a valid Keycloak access token (`Authorization: Bearer <token>`),
verified against the realm's JWKS. The realm is provided by whoever deploys
Kanecta — there is no default, so set both of these:

```bash
KEYCLOAK_URL=https://keycloak.example.com KEYCLOAK_REALM=my-realm npm start
```

`req.user` is populated from the token's claims: `{ id, name, roles, email_verified }`.

For local development without a Keycloak instance, set `AUTH_DISABLED=true` to
bypass verification entirely — every request is treated as an authenticated
local admin (`req.user = { id: 'local-dev', name: 'Local Dev', roles: ['admin'], email_verified: true }`).
Never set this in a real deployment.

```bash
AUTH_DISABLED=true npm start
```

To develop and test against a real Keycloak instance, the `kanecta-keycloak`
workspace package stands up Keycloak + Postgres + MinIO via Docker Compose
with a pre-seeded test realm:

```bash
npm run docker:up -w kanecta-keycloak
```

## Endpoints

### Search

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/search?q=&rootId=&limit=` | Full-text search. `rootId` scopes to a subtree. Each result includes an `ancestors` breadcrumb array. |

### Items

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/items` | List top-level items (children of `data_root`) |
| `POST` | `/items` | Create item. Accepts `alias` to set a shortcut in the same call. |
| `POST` | `/items/bulk` | Create multiple items. Returns `{ created, errors }`. |
| `PATCH` | `/items/bulk` | Update multiple items. Body: `{ updates: [{id, ...changes}] }`. |
| `GET` | `/items/:id` | Get item by UUID |
| `PUT` | `/items/:id` | Update item. Accepts `parentId` to move, `sortOrder` to reposition. |
| `DELETE` | `/items/:id` | Delete item **and all descendants**. Use `?force=true` to skip reference conflict check. |
| `GET` | `/items/:id/children` | List direct children |
| `GET` | `/items/:id/tree` | Subtree rooted at item. `?depth=n` limits expansion. |
| `GET` | `/items/:id/ancestors` | Full path from root down to this item's parent |
| `POST` | `/items/:id/clone` | Deep-copy item and all descendants. Body: `{ targetParentId }`. |
| `GET` | `/items/:id/annotations` | List annotations |
| `POST` | `/items/:id/annotations` | Add annotation. Body: `{ content, author?, parentAnnotationId? }`. |
| `GET` | `/items/:id/relationships` | List relationships |
| `GET` | `/items/:id/backlinks` | List items with `[[uuid]]` links pointing here |
| `GET` | `/items/:id/history` | Change history |

### Tree

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/tree` | Full tree from all roots. `?depth=n` limits expansion. |

### Aliases

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/aliases` | List all aliases |
| `GET` | `/aliases/:alias` | Resolve alias to UUID |
| `POST` | `/aliases` | Set alias. Body: `{ alias, targetId }`. |
| `DELETE` | `/aliases/:alias` | Remove alias |

### Relationships

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/relationships` | List all relationships |
| `POST` | `/relationships` | Create relationship. Body: `{ sourceId, type, targetId, note? }`. |

### Tags

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/tags/:tag` | List all item IDs carrying this tag |

### Index

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/rebuild-indexes` | Rebuild all index caches from `data/` |

## Running tests

```bash
npm test
```
