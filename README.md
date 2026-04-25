# Kanecta

Kanecta is an open-source, self-hosted personal and organisational information repository. Data is stored as a hierarchical tree of items on the filesystem — no database required. Each item has a globally unique UUID, a type, an owner, and an optional value, and items can reference each other through inline `[[uuid]]` syntax or symlink items.

---

## Repository layout

```
kanecta/
├── kanecta-specification/    — Canonical data model spec (v1.0)
├── kanecta-datastore-sample/ — Sample datastore for development and testing
├── kanecta-api/              — Node.js/Express HTTP API
├── kanecta-cli/              — Node.js CLI for text export
└── kanecta-client-web/       — React/TypeScript web UI
```

---

## Data model

Items are stored in `.kanecta/data/` using a 16-level sharded UUID directory structure. Each item is a folder containing a `metadata.json` file and optional attached files.

```
.kanecta/data/a1/b2/c3/d4/e5/f6/ab/cd/ef/12/34/56/78/90/12/34/metadata.json
```

**`metadata.json` structure:**

```json
{
  "id": "a1b2c3d4-e5f6-abcd-ef12-345678901234",
  "parent_id": "uuid or null",
  "value": "The item's text content",
  "type": "string | number | text | file | symlink | object",
  "type_id": "uuid or null",
  "owner": "user@example.com",
  "license": "string or null",
  "sort_order": 0,
  "cached_at": "ISO8601 or null",
  "subscribed_at": "ISO8601 or null",
  "subscription_source": "url or null"
}
```

The `.kanecta/` directory also maintains index caches for aliases, types, remotes, backlinks, and search.

The full data model, business rules, and directory specification are in [`kanecta-specification/specification.md`](kanecta-specification/specification.md).

---

## Sub-projects

### `kanecta-api`

A Node.js/Express HTTP server that exposes datastore contents over a REST API.

**Tech:** Node.js, Express 4, Jest, Supertest

**Endpoints:**

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/items/:id` | Returns the metadata for a single item |
| `GET` | `/items/:id?levels=N` | Returns the item and its descendants as a nested tree, up to N levels deep |

**Examples:**

```
GET /items/f1a00001-b45e-4c3d-9e7f-000000000001
GET /items/f1a00001-b45e-4c3d-9e7f-000000000001?levels=3
```

`levels=1` returns the item alone, `levels=2` includes direct children, `levels=3` includes grandchildren, and so on.

**Running:**

```bash
cd kanecta-api
npm install
npm start          # listens on port 3000
```

**Environment variables:**

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `3000` | Port the server listens on |
| `KANECTA_DATASTORE` | `../kanecta-datastore-sample` | Path to the datastore root |

**Tests:**

```bash
npm test
```

---

### `kanecta-cli`

A Node.js script that reads the datastore and writes a hierarchical plain-text file.

**Tech:** Node.js (no dependencies)

**Usage:**

```bash
cd kanecta-cli
npm run kanecta
```

Reads the `defaultView` from the datastore's `config.json` (root item ID and max depth), walks the tree, and writes `kanecta.txt` to the datastore root.

---

### `kanecta-client-web`

A React/TypeScript single-page app for browsing a Kanecta datastore through the API.

**Tech:** React 19, TypeScript 6, Vite 8, Sass, ESLint, Prettier, Storybook 10

**Running in development:**

Start the API server first (the web client proxies all `/api` requests to `localhost:3000`):

```bash
# terminal 1
cd kanecta-api && npm start

# terminal 2
cd kanecta-client-web
npm install
npm run dev        # http://localhost:5173
```

**Other scripts:**

```bash
npm run build          # type-check + production build
npm run lint           # ESLint
npm run format         # Prettier (writes)
npm run format:check   # Prettier (check only)
npm run storybook      # component explorer on http://localhost:6006
npm run build-storybook
```

**How it works:**

The app fetches a configurable root item from the API and renders it as an interactive tree. A number input controls how many levels of descendants are loaded — changing it immediately triggers a new fetch.

The Vite dev server is configured to proxy `/api/*` to `http://localhost:3000`, so no CORS setup is needed during development.

---

### `kanecta-datastore-sample`

A pre-populated sample datastore used by the API, CLI, and their tests. It contains the "Base Work Process" workflow as a small item tree, which makes it easy to verify that all parts of the stack are working without needing a real personal datastore.

**Structure:**

```
kanecta-datastore-sample/
└── .kanecta/
    ├── config/        — config.json (owner, defaultView)
    ├── data/          — item folders (metadata.json)
    ├── aliases/
    ├── types/
    ├── remotes/
    ├── remotes-index/
    ├── links/
    └── search/
```

---

## How the pieces fit together

```
kanecta-client-web  →  /api/items/:id?levels=N  →  kanecta-api  →  kanecta-datastore-sample
     (React UI)            (Vite proxy)            (Express)          (filesystem)

kanecta-cli  →  kanecta-datastore-sample  →  kanecta.txt
  (Node.js)         (filesystem)             (plain text)
```

---

## Technology summary

| Component | Language / Framework | Key dependencies |
|-----------|---------------------|-----------------|
| API | Node.js + Express | express, jest, supertest |
| CLI | Node.js | — |
| Web UI | React + TypeScript | vite, sass, eslint, prettier, storybook |
| Datastore | Filesystem | — |
