# Layered Datastore Design: Filesystem + SQLite + Memory

## The problem

`kanecta-filesystem`'s `loadAll()` walks the entire `data/` directory tree and reads every `metadata.json` one at a time. At 200k items that's 200k file reads. Every call to `tree()`, `children()`, `query()`, and search triggers it — so a long-running process re-walks the disk on every query.

`byType()` is already fast — it reads a single pre-built `items.json` index file. The problem is everything else.

---

## What we considered

### NDJSON flat index
One `all-items.ndjson` file, one line per item. Cold read of 1 million items (~300MB) takes 2–4 seconds just for I/O and JSON parsing. Updates and deletes require rewriting the whole file. Ruled out at scale.

### In-memory cache only
Populate a `Map` on first `loadAll()`, update it on every write. Fast warm path, zero cost for repeated queries in the same process. Cold start still walks the disk. Good enough for small workspaces, not a real fix.

### B-trees / SQLite
SQLite is a B-tree engine. Every table and index is a B-tree stored in fixed-size pages (default 4KB). A point lookup by ID reads 3–5 pages regardless of table size. A prefix-indexed path column answers subtree queries in single-digit milliseconds on a million-row table.

Static folder sharding (what kanecta does today) actually beats B-trees for direct ID lookups — given a UUID you compute the exact path instantly, no searching. But B-trees win on every other query type.

### Materialized path for the tree
Each item stores its full ancestor path as a string, e.g. `root/a/b/c`. Descendants of a node = one prefix query: `WHERE path LIKE 'root/a/b/%'`. Needs a prefix index on `path`. Fast reads, simple to understand.

Move cost: updating a subtree requires rewriting the path of every descendant — one SQL statement but touches every row in the subtree. Acceptable because moves are rare user gestures, not hot-loop operations.

---

## The design we landed on

Three layers, each with a clear job:

```
┌─────────────────────────────────┐
│         Memory (Map)            │  fastest, volatile
├─────────────────────────────────┤
│         SQLite index            │  fast, persistent, rebuildable
├─────────────────────────────────┤
│    Filesystem (source of truth) │  slow, authoritative, human-readable
└─────────────────────────────────┘
```

### Filesystem — source of truth
- Item folders remain exactly as they are today
- `metadata.json` stays in each folder, human-readable, self-contained
- Attachments and freeform content in the folder, unchanged
- The folder is still the thing you back up
- If SQLite and the filesystem ever disagree, the filesystem wins

### SQLite — fast index (`k/index.db`)
- One file alongside the data folder
- Indexes on: `id`, `path` (materialized path), `type_id`, `created_at`, `tags`
- Built from the filesystem — can be deleted and rebuilt with `rebuildIndexes()`
- Never the source of truth, always derived
- Single file = trivial to back up, safe to copy (WAL + checksums prevent corruption)
- `better-sqlite3` is the Node.js library

### Memory — warm cache (in-process `Map`)
- Populated from SQLite on cold start (`SELECT * FROM items` — one query)
- Updated on every write alongside SQLite and the filesystem
- Lost on restart, rebuilt from SQLite (not from the filesystem)
- Zero I/O for any query once warm

### Write path
1. Write `metadata.json` to filesystem first (source of truth)
2. Update the SQLite row
3. Update the in-memory `Map`

A crash between steps 1 and 2 leaves SQLite slightly stale — `rebuildIndexes()` fixes it. No corruption possible.

### Read path
1. Check `Map` — if warm, return instantly (zero I/O)
2. Query SQLite — fast, indexed, a few page reads
3. Filesystem — only for full item content (attachments, freeform data) or on cold start

### Cold start
1. Open `index.db`
2. `SELECT * FROM items` → populate `Map`
3. Ready — no directory walking

### SQLite schema (sketch)

```sql
CREATE TABLE items (
  id          TEXT PRIMARY KEY,
  path        TEXT NOT NULL,
  type_id     TEXT,
  title       TEXT,
  created_at  TEXT,
  updated_at  TEXT,
  metadata    TEXT  -- full JSON blob for fields not worth indexing
);

CREATE INDEX idx_items_path     ON items(path);
CREATE INDEX idx_items_type_id  ON items(type_id);
CREATE INDEX idx_items_created  ON items(created_at);
```

Subtree query:
```sql
SELECT * FROM items WHERE path LIKE 'root/a/b/%';
```

Move (rename subtree path):
```sql
UPDATE items
SET path = '/new/path' || substr(path, length('/old/path') + 1)
WHERE path LIKE '/old/path/%';
```

---

## What you keep from today

- Item folders exactly as they are — browsable in Finder, human-readable
- `metadata.json` in every folder
- The freeform "drop anything in the folder" property
- `rebuildIndexes()` as the recovery tool
- Backup story: the folder tree is still the thing that matters; SQLite is expendable

## What you gain

- `loadAll()` and tree queries go from O(n file reads) to O(1) SQLite query
- Subtree queries via materialized path — fast regardless of depth or size
- In-memory warm path — zero I/O for repeated queries in the same process
- SQLite's WAL makes the index more crash-safe than the current multi-file write path

## Implementation path

This maps cleanly to a new `SQLiteFilesystemAdapter` — same interface as `FilesystemAdapter`, different internals. The `Datastore` class wouldn't need to change. `rebuildIndexes()` becomes "walk the folders, populate SQLite". The filesystem adapter could stay as a fallback for environments where SQLite isn't available.

This is the local equivalent of what the cloud adapter already does: Postgres + S3 = SQLite + filesystem.
