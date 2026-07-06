// Test fixture generator — builds a known sample datastore using the CURRENT
// adapter, so it can never go stale the way a committed datastore does. Each test
// suite that needs a populated store calls this into a fresh temp directory; the
// content below is the single source of truth for assertions.
//
// Returns { root, ids } where `root` is the datastore directory and `ids` maps
// well-known fixture nodes to their generated UUIDs (UUIDs are random per build,
// so always reference them through `ids`, never by literal).
//
// Shape (everything lives under the all-zeros root, per 1.4.0 — there is no
// data_root):
//
//   Base Work Process            (alias: base-work-process)
//   ├── Clarify
//   │   ├── Confirm the goal and success criteria before starting
//   │   ├── Identify constraints (time, tech stack, compatibility)
//   │   └── Ask questions now — not mid-build
//   ├── Build
//   │   ├── Make the smallest change that works
//   │   └── Keep the build green
//   ├── Review
//   │   └── Check it does what was asked
//   └── Principles
//       ├── Simplicity over cleverness
//       └── Leave it better than you found it

import { SqliteFsAdapter } from '../src/adapter';

function makeSampleDatastore(dir: any, { owner = 'sample@kanecta.test' } = {}) {
  const ds = SqliteFsAdapter.init(dir, owner);

  const bwp = ds.create({ value: 'Base Work Process', type: 'text', owner });
  ds.setAlias('base-work-process', bwp.id);

  const clarify = ds.create({ value: 'Clarify', parentId: bwp.id, sortOrder: 0, owner });
  ds.create({ value: 'Confirm the goal and success criteria before starting', parentId: clarify.id, sortOrder: 0, owner });
  ds.create({ value: 'Identify constraints (time, tech stack, compatibility)', parentId: clarify.id, sortOrder: 1, owner });
  ds.create({ value: 'Ask questions now — not mid-build', parentId: clarify.id, sortOrder: 2, owner });

  const build = ds.create({ value: 'Build', parentId: bwp.id, sortOrder: 1, owner });
  ds.create({ value: 'Make the smallest change that works', parentId: build.id, sortOrder: 0, owner });
  ds.create({ value: 'Keep the build green', parentId: build.id, sortOrder: 1, owner });

  const review = ds.create({ value: 'Review', parentId: bwp.id, sortOrder: 2, owner });
  ds.create({ value: 'Check it does what was asked', parentId: review.id, sortOrder: 0, owner });

  const principles = ds.create({ value: 'Principles', parentId: bwp.id, sortOrder: 3, owner });
  ds.create({ value: 'Simplicity over cleverness', parentId: principles.id, sortOrder: 0, owner });
  ds.create({ value: 'Leave it better than you found it', parentId: principles.id, sortOrder: 1, owner });

  // Counts callers can assert against (kept here so they update with the shape).
  // tree(bwp) = bwp + 4 phase headings + 8 leaves = 13 nodes.
  // loadAll   = root + types + Welcome + the 13 above = 16 content items
  //             (alias + the seeded built-in type items are excluded from loadAll).
  // rebuild   = the raw items-table count = 16 content + 1 alias + 26 built-in
  //             type items seeded at init = 43.
  const counts = { treeFromBaseWorkProcess: 13, loadAll: 16, rebuild: 43 };

  const ids = {
    root: '00000000-0000-0000-0000-000000000000',
    baseWorkProcess: bwp.id,
    clarify: clarify.id,
    build: build.id,
    review: review.id,
    principles: principles.id,
  };

  (ds as any).close?.();
  return { root: dir, ids, counts };
}

export { makeSampleDatastore };
