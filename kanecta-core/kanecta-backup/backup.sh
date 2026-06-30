#!/usr/bin/env bash
set -euo pipefail

if [[ -z "${KANECTA_BACKUP_DIRECTORY:-}" ]]; then
  echo "error: KANECTA_BACKUP_DIRECTORY is not set" >&2
  exit 1
fi

# Resolve the active working set's local datastore via the shared resolver
# (honors KANECTA_CONFIG / KANECTA_WORKING_SET). Pass a path as $1 to override.
DATASTORE="${1:-$(node -e 'const a=require("@kanecta/lib");const{workingSet}=a.resolveWorkingSet();process.stdout.write(a.workingSetLocalPath(workingSet)||"")' 2>/dev/null || true)}"

if [[ -z "$DATASTORE" || ! -d "$DATASTORE" ]]; then
  echo "error: could not resolve a local datastore to back up (set KANECTA_CONFIG, or pass a path as the first argument)" >&2
  exit 1
fi

timestamp="$(date +%Y-%m-%d-%H-%M-%S)"
destination="$KANECTA_BACKUP_DIRECTORY/kanecta-backup-$timestamp"

mkdir -p "$destination"

# Trailing slash on the source copies the datastore's contents into
# destination rather than nesting it in a subdirectory named after the source.
rsync -a "$DATASTORE/" "$destination/"

echo "Backed up '$DATASTORE' to '$destination'"
