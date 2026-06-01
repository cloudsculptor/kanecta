# kanecta-system-items

Shared library of Kanecta system items — type definitions, instances, links, and other objects that are useful across datastores. Items are stored in the standard datastore format under `items/` — the same sharded UUID structure used in a live datastore.

## Syncing into your local datastore

The studio app has a built-in sync tool. Open **kanecta-app-studio**, go to **Templates → Types**, and use the **Sync** button. It reads from the directory configured in `KANECTA_SYSTEM_ITEMS_DIR` (set to this folder by default in `npm start`) and lets you import items into your local datastore.

## Contributing

If you create an item that could be useful to others, export it back to this folder via the same sync tool and commit it. Keep items general — avoid values that are specific to one project or organisation.
