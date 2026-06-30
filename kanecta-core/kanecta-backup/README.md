# kanecta-backup

A small rsync-based script for backing up a Kanecta datastore to a local
backup directory.

## Usage

Set the following environment variables:

- `KANECTA_BACKUP_DIRECTORY` — path to the directory where backups are stored
- `KANECTA_CONFIG` (optional) — locates `config.json`; the active working set's
  local datastore is backed up. Or pass a datastore path as the first argument.

Then run:

```sh
./backup.sh               # back up the active working set's datastore
./backup.sh /path/to/ds   # or back up an explicit datastore directory
```

The script copies the entire contents of the resolved datastore into a new
timestamped folder under `KANECTA_BACKUP_DIRECTORY`, named:

```
kanecta-backup-yyyy-mm-dd-hh-mm-ss
```

For example:

```
kanecta-backup-2026-06-08-14-32-07
```

## Notes

- Uses `rsync -a` to preserve permissions, timestamps, symlinks, etc.
- The backup directory is created automatically if it doesn't exist.
- Each run produces a fresh, independent copy — nothing is overwritten or
  pruned. Manage retention of old backups separately.
