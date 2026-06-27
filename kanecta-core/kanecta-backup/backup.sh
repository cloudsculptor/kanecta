#!/usr/bin/env bash
set -euo pipefail

if [[ -z "${KANECTA_DATASTORE:-}" ]]; then
  echo "error: KANECTA_DATASTORE is not set" >&2
  exit 1
fi

if [[ -z "${KANECTA_BACKUP_DIRECTORY:-}" ]]; then
  echo "error: KANECTA_BACKUP_DIRECTORY is not set" >&2
  exit 1
fi

if [[ ! -d "$KANECTA_DATASTORE" ]]; then
  echo "error: KANECTA_DATASTORE '$KANECTA_DATASTORE' is not a directory" >&2
  exit 1
fi

timestamp="$(date +%Y-%m-%d-%H-%M-%S)"
destination="$KANECTA_BACKUP_DIRECTORY/kanecta-backup-$timestamp"

mkdir -p "$destination"

# Trailing slash on the source copies the datastore's contents into
# destination rather than nesting it in a subdirectory named after the source.
rsync -a "$KANECTA_DATASTORE/" "$destination/"

echo "Backed up '$KANECTA_DATASTORE' to '$destination'"
