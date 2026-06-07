# kanecta-backup

A small rsync-based script for backing up a Kanecta datastore to a local
backup directory.

## Usage

Set the following environment variables:

- `KANECTA_DATASTORE` — path to the datastore directory to back up
- `KANECTA_BACKUP_DIRECTORY` — path to the directory where backups are stored

Then run:

```sh
./backup.sh
```

The script copies the entire contents of `KANECTA_DATASTORE` into a new
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
