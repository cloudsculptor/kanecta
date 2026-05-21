#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BACKUP_DIR="${BACKUP_DIR:-$SCRIPT_DIR/backups}"

# Load .env if present — used when ~/.pgpass is not set up
if [[ -f "$SCRIPT_DIR/.env" ]]; then
  set -a
  # shellcheck disable=SC1091
  source "$SCRIPT_DIR/.env"
  set +a
fi

: "${DB_HOST:?DB_HOST not set — see README.md for credential setup}"
: "${DB_NAME:?DB_NAME not set — see README.md for credential setup}"
: "${DB_USER:?DB_USER not set — see README.md for credential setup}"
DB_PORT="${DB_PORT:-25060}"

# Map DB_PASSWORD → PGPASSWORD if the password was set via .env rather than ~/.pgpass
if [[ -n "${DB_PASSWORD:-}" && -z "${PGPASSWORD:-}" ]]; then
  export PGPASSWORD="$DB_PASSWORD"
fi

if ! command -v pg_dump &>/dev/null; then
  echo "Error: pg_dump not found. Install postgresql-client and retry." >&2
  exit 1
fi

if ! command -v zip &>/dev/null; then
  echo "Error: zip not found. Install zip and retry." >&2
  exit 1
fi

mkdir -p "$BACKUP_DIR"

TIMESTAMP=$(date '+%Y-%m-%d-%H.%M')
FILENAME="community-hub-db-${TIMESTAMP}"
DUMP_FILE="$BACKUP_DIR/${FILENAME}.dump"
ZIP_FILE="$BACKUP_DIR/${FILENAME}.zip"

echo "Backing up '$DB_NAME' on $DB_HOST:$DB_PORT ..."

PGSSLMODE=require pg_dump \
  --host="$DB_HOST" \
  --port="$DB_PORT" \
  --username="$DB_USER" \
  --dbname="$DB_NAME" \
  --format=custom \
  --verbose \
  --file="$DUMP_FILE"

zip -j "$ZIP_FILE" "$DUMP_FILE"
rm "$DUMP_FILE"

echo ""
echo "Backup complete: $ZIP_FILE"
echo "Size: $(du -sh "$ZIP_FILE" | cut -f1)"
