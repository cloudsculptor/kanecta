# kanecta-migrations

Automated scripts to help customers migrate their Kanecta datastore between
spec versions.

## Layout

Migrations are stored in child folders named for the **target** spec version,
e.g. `1.3.0/`. Each folder contains whatever scripts (and notes) are needed to
bring a datastore from the previous spec version up to that target version.

Not every version bump needs an automated script — see `1.3.0/README.md` for
an example of a version that was migrated manually instead.
