# Community Hub Admin

## Database Backup

### What the backup contains

`backup.sh` uses `pg_dump --format=custom` — PostgreSQL's native binary backup format. It captures all tables (schema + data) in a single compressed file. The dump is then wrapped in a `.zip` file named:

```
community-hub-db-YYYY-MM-DD-HH.MM.zip
```

The inner `.dump` file is what `pg_restore` uses for restoration.

### PostgreSQL version

The production database runs PostgreSQL **18** — confirm with:

```bash
PGSSLMODE=require psql -h $DB_HOST -p $DB_PORT -U $DB_USER -d $DB_NAME -c "SELECT version();"
```

Use a matching or newer `pg_dump`/`pg_restore` version locally. On Ubuntu/Debian:

```bash
sudo apt install postgresql-client-18
```

---

## Credential setup (two options)

### Option 1 — `~/.pgpass` (recommended)

The `~/.pgpass` file is PostgreSQL's native credential store. It lives in your home directory, outside the project, and is never committed.

1. Open or create `~/.pgpass`:

   ```
   hostname:port:database:username:password
   ```

2. Lock down permissions (required — Postgres ignores the file otherwise):

   ```bash
   chmod 600 ~/.pgpass
   ```

3. Create a `.env` file with everything **except** the password:

   ```bash
   cp .env.example .env
   # fill in DB_HOST, DB_NAME, DB_USER — leave DB_PASSWORD commented out
   ```

### Option 2 — `.env` file (simpler, slightly less secure)

```bash
cp .env.example .env
chmod 600 .env
# edit .env — fill in DB_HOST, DB_PORT, DB_NAME, DB_USER, and DB_PASSWORD
```

`.env` is gitignored and will never be committed. The script maps `DB_PASSWORD` to `PGPASSWORD` automatically before calling `pg_dump`.

---

## Running a backup

```bash
# Make executable (once)
chmod +x backup.sh

./backup.sh
```

Backups are saved to `backups/` (gitignored). They are never committed.

---

## Restoring from a backup

### 1. Unzip

```bash
unzip community-hub-db-2026-12-31-13.56.zip -d restore/
# produces: restore/community-hub-db-2026-12-31-13.56.dump
```

### 2. Create the target database (if it doesn't exist)

```bash
createdb -h <host> -p <port> -U <user> community_hub_restore
```

### 3. Restore

```bash
pg_restore \
  --host=<host> \
  --port=<port> \
  --username=<user> \
  --dbname=community_hub_restore \
  --verbose \
  restore/community-hub-db-2026-12-31-13.56.dump
```

### Restore to the same database (overwrite)

```bash
# Drop all existing objects first, then restore
pg_restore \
  --host=<host> \
  --port=<port> \
  --username=<user> \
  --dbname=<dbname> \
  --clean \
  --if-exists \
  --verbose \
  restore/community-hub-db-2026-12-31-13.56.dump
```

### Restore a single table

```bash
pg_restore \
  --host=<host> \
  --port=<port> \
  --username=<user> \
  --dbname=<dbname> \
  --table=discussions_messages \
  restore/community-hub-db-2026-12-31-13.56.dump
```

---

## Database tables (as of migration 018)

| Table | Description |
|-------|-------------|
| `discussions_threads` | Thread metadata |
| `discussions_messages` | Messages and replies |
| `discussions_reactions` | Emoji reactions |
| `finances_*` | Finance records |
| `pages` / `page_history` | CMS pages |
| `files` | Uploaded file metadata |
| `groups` | Resilience groups |
| `licences` | Dog/licence records |
| `push_subscriptions` | Web push endpoints |
