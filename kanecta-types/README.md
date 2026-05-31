# kanecta-types

Shared library of Kanecta type definitions. Each type is stored in the standard datastore format under `types/` — the same sharded UUID structure used in a live datastore.

## Syncing types into your local datastore

The studio app has a built-in sync tool. Open **kanecta-app-studio**, go to **Templates → Types**, and use the **Sync** button. It reads from the directory configured in `KANECTA_COMMON_TYPES_DIR` (set to this folder by default in `npm start`) and lets you import any type into your local datastore.

## Contributing new types

If you create a type that could be useful to others, export it back to this folder via the same sync tool and commit it. Keep type definitions general — avoid values that are specific to one project or organisation.
