'use strict';

const fs   = require('fs');
const path = require('path');
const os   = require('os');
const { SqliteFsAdapter, ROOT_ID } = require('../src/adapter');

// ─── Helpers ──────────────────────────────────────────────────────────────────

function tmpAdapter() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'kanecta-sparse-'));
  return SqliteFsAdapter.init(root, 'test@example.com');
}

function cleanup(a) { fs.rmSync(a.root, { recursive: true, force: true }); }

// Advance the wall clock so a following write gets a strictly-later `modifiedAt`
// than the branch point (the watermark comparison is strict). Real merges happen
// long after the fork; this just makes that ordering deterministic in-test.
function tick(ms = 2) { const until = Date.now() + ms; while (Date.now() < until) { /* spin */ } }

function itemPathOn(a, branch, id) {
  const hex = id.replace(/-/g, '');
  return path.join(a.k, 'branches', branch, 'items', hex.slice(0, 2), hex.slice(2, 4), id, 'item.json');
}

// Build a datastore with a couple of content items on main, then a sparse
// branch that reads through to main. Returns { a, onMain, child }.
function withSparseBranch() {
  const a      = tmpAdapter();
  const onMain = a.create({ value: 'on main', type: 'text' });
  const child  = a.create({ value: 'child', type: 'text', parentId: onMain.id });
  a.createBranch('feature/sparse', { fill: 'sparse' });
  a.useBranch('feature/sparse');
  return { a, onMain, child };
}

// ─── Creation ───────────────────────────────────────────────────────────────

describe('sparse branch creation', () => {
  test('createBranch(sparse) writes a sparse manifest and an empty items/ tree', () => {
    const a = tmpAdapter();
    const item = a.create({ value: 'on main', type: 'text' });
    const b = a.createBranch('feature/sparse', { fill: 'sparse' });

    expect(b.fill).toBe('sparse');
    expect(b.upstream).toEqual({ branch: 'main' });

    const dir = path.join(a.k, 'branches', 'feature__sparse');
    const manifest = JSON.parse(fs.readFileSync(path.join(dir, 'branch.json'), 'utf8'));
    expect(manifest.fill).toBe('sparse');
    expect(manifest.upstream).toEqual({ branch: 'main' });
    expect(manifest.base).toBe('main');
    expect(manifest.branchPoint?.branch).toBe('main');

    // The base item.json is NOT copied — items/ holds only local changes.
    expect(fs.existsSync(itemPathOn(a, 'feature__sparse', item.id))).toBe(false);
    cleanup(a);
  });

  test('listBranches reports the sparse fill + upstream', () => {
    const a = tmpAdapter();
    a.createBranch('feature/sparse', { fill: 'sparse' });
    const [b] = a.listBranches();
    expect(b.name).toBe('feature/sparse');
    expect(b.fill).toBe('sparse');
    expect(b.upstream).toEqual({ branch: 'main' });
    cleanup(a);
  });
});

// ─── Read-through ─────────────────────────────────────────────────────────────

describe('sparse branch reads through to upstream', () => {
  test('get() resolves upstream items not present locally', () => {
    const { a, onMain, child } = withSparseBranch();
    expect(a.currentBranch()).toBe('feature/sparse');
    expect(a.get(onMain.id)?.value).toBe('on main');
    expect(a.get(child.id)?.value).toBe('child');
    cleanup(a);
  });

  test('children() / tree() / loadAll() see the upstream tree', () => {
    const { a, onMain, child } = withSparseBranch();
    const kids = a.children(onMain.id);
    expect(kids.map(k => k.id)).toContain(child.id);

    const ids = a.loadAll().map(i => i.id);
    expect(ids).toEqual(expect.arrayContaining([onMain.id, child.id]));

    const tree = a.tree(onMain.id);
    expect(tree.some(n => n.item.id === child.id)).toBe(true);
    cleanup(a);
  });

  test('readObjectJson() falls through to the upstream payload', () => {
    const a = tmpAdapter();
    const obj = a.create({ value: 'typed', type: 'object' });
    a.writeObjectJson(obj.id, { foo: 'bar' });
    a.createBranch('feature/sparse', { fill: 'sparse' });
    a.useBranch('feature/sparse');
    expect(a.readObjectJson(obj.id)).toEqual({ foo: 'bar' });
    cleanup(a);
  });
});

// ─── Local changes ────────────────────────────────────────────────────────────

describe('sparse branch local changes', () => {
  test('a local add is visible on the branch and absent from upstream', () => {
    const { a } = withSparseBranch();
    const added = a.create({ value: 'branch only', type: 'text' });
    expect(a.get(added.id)?.value).toBe('branch only');
    expect(fs.existsSync(itemPathOn(a, 'feature__sparse', added.id))).toBe(true);

    a.useBranch('main');
    expect(a.get(added.id)).toBeNull();
    cleanup(a);
  });

  test('a local edit materialises locally and leaves upstream untouched', () => {
    const { a, onMain } = withSparseBranch();
    a.update(onMain.id, { value: 'edited on branch' }, 'test@example.com');
    expect(a.get(onMain.id)?.value).toBe('edited on branch');
    expect(fs.existsSync(itemPathOn(a, 'feature__sparse', onMain.id))).toBe(true);

    a.useBranch('main');
    expect(a.get(onMain.id)?.value).toBe('on main');
    cleanup(a);
  });

  test('a local delete writes a tombstone that masks the upstream item', () => {
    const { a, child } = withSparseBranch();
    a.delete(child.id, 'test@example.com');

    // Masked on read.
    expect(a.get(child.id)).toBeNull();
    // Tombstone file exists locally.
    const raw = JSON.parse(fs.readFileSync(itemPathOn(a, 'feature__sparse', child.id), 'utf8'));
    expect(raw.tombstone).toBe(true);

    // Upstream is untouched.
    a.useBranch('main');
    expect(a.get(child.id)?.value).toBe('child');
    cleanup(a);
  });

  test('the sparse index is fully derived — rebuildIndexes() reprojects it', () => {
    const { a, onMain } = withSparseBranch();
    const added = a.create({ value: 'branch only', type: 'text' });
    a.delete(onMain.id, 'test@example.com'); // tombstone masking an upstream item

    // Wipe + reproject the index purely from items/ + the local upstream.
    a.rebuildIndexes();
    expect(a.get(added.id)?.value).toBe('branch only');
    expect(a.get(onMain.id)).toBeNull();
    // The untouched child is still inherited from upstream.
    const inherited = a.loadAll().some(i => i.value === 'child');
    expect(inherited).toBe(true);
    cleanup(a);
  });
});

// ─── Diff + merge ─────────────────────────────────────────────────────────────

describe('sparse branch diff + merge', () => {
  test('branchDiff reports only local adds/edits/deletes (not inherited items)', () => {
    const { a, onMain, child } = withSparseBranch();
    const added = a.create({ value: 'branch only', type: 'text' });
    a.update(onMain.id, { value: 'edited' }, 'test@example.com');
    a.delete(child.id, 'test@example.com');

    const diff = a.branchDiff('feature/sparse');
    expect(diff.adds.map(x => x.id)).toContain(added.id);
    expect(diff.edits.map(x => x.id)).toContain(onMain.id);
    expect(diff.deletes.map(x => x.id)).toContain(child.id);
    // The untouched root is inherited, not a delete.
    expect(diff.deletes.map(x => x.id)).not.toContain(ROOT_ID);
    cleanup(a);
  });

  test('mergeBranchLocally applies the sparse diff to main', () => {
    const { a, onMain, child } = withSparseBranch();
    const added = a.create({ value: 'branch only', type: 'text' });
    a.update(onMain.id, { value: 'edited' }, 'test@example.com');
    a.delete(child.id, 'test@example.com');

    a.useBranch('main');
    const res = a.mergeBranchLocally('feature/sparse');
    expect(res.merged).toBe(3);

    expect(a.get(added.id)?.value).toBe('branch only');
    expect(a.get(onMain.id)?.value).toBe('edited');
    expect(a.get(child.id)).toBeNull();
    cleanup(a);
  });
});

// ─── Conflict-aware merge (per-item watermark) ─────────────────────────────────

// Fork a sparse branch, mutate the SAME upstream item on main after the fork, and
// edit it on the branch — exercising the branchPoint watermark that distinguishes
// a clean EDIT from a CONFLICT.
function withDivergedEdit() {
  const a      = tmpAdapter();
  const onMain = a.create({ value: 'v0', type: 'text' });
  a.createBranch('feature/sparse', { fill: 'sparse' });

  // Edit on the branch.
  a.useBranch('feature/sparse');
  a.update(onMain.id, { value: 'branch edit' }, 'test@example.com');

  // Independently edit the SAME item on main, AFTER the branch point.
  a.useBranch('main');
  tick();
  a.update(onMain.id, { value: 'main edit' }, 'someone@else.com');

  return { a, onMain };
}

describe('sparse branch conflict-aware merge', () => {
  test('previewMerge flags an item edited on BOTH sides as a conflict', () => {
    const { a, onMain } = withDivergedEdit();
    const preview = a.previewMerge('feature/sparse');
    expect(preview.edits.map(e => e.id)).toContain(onMain.id);
    expect(preview.conflicts.map(c => c.id)).toContain(onMain.id);
    expect(preview.conflicts[0].kind).toBe('edit-edit');
    cleanup(a);
  });

  test('previewMerge reports NO conflict when upstream is untouched since the fork', () => {
    const { a, onMain } = withSparseBranch();
    a.update(onMain.id, { value: 'branch only edit' }, 'test@example.com');
    const preview = a.previewMerge('feature/sparse');
    expect(preview.edits.map(e => e.id)).toContain(onMain.id);
    expect(preview.conflicts).toEqual([]);
    cleanup(a);
  });

  test('mergeBranchLocally ABORTS on conflict — nothing applied, branch preserved', () => {
    const { a, onMain } = withDivergedEdit();
    a.useBranch('main');

    let err;
    try { a.mergeBranchLocally('feature/sparse'); } catch (e) { err = e; }
    expect(err).toBeDefined();
    expect(err.code).toBe('MERGE_CONFLICT');
    expect(err.conflicts.map(c => c.id)).toContain(onMain.id);

    // Upstream is untouched by the aborted merge…
    expect(a.get(onMain.id)?.value).toBe('main edit');
    // …and the branch still exists for the caller to resolve.
    expect(a.listBranches().map(b => b.name)).toContain('feature/sparse');
    cleanup(a);
  });

  test("strategy 'theirs' forces the branch to win", () => {
    const { a, onMain } = withDivergedEdit();
    a.useBranch('main');
    const res = a.mergeBranchLocally('feature/sparse', { strategy: 'theirs' });
    expect(res.merged).toBe(1);
    expect(res.skipped).toBe(0);
    expect(a.get(onMain.id)?.value).toBe('branch edit');
    cleanup(a);
  });

  test("strategy 'ours' keeps upstream and skips the conflicting change", () => {
    const { a, onMain } = withDivergedEdit();
    a.useBranch('main');
    const res = a.mergeBranchLocally('feature/sparse', { strategy: 'ours' });
    expect(res.skipped).toBe(1);
    expect(res.merged).toBe(0);
    // Upstream value is preserved.
    expect(a.get(onMain.id)?.value).toBe('main edit');
    // Branch folder is consumed by the merge.
    expect(a.listBranches().map(b => b.name)).not.toContain('feature/sparse');
    cleanup(a);
  });

  test('a clean edit still merges alongside a conflicting one under a strategy', () => {
    const a       = tmpAdapter();
    const conf    = a.create({ value: 'c0', type: 'text' });
    const clean   = a.create({ value: 'k0', type: 'text' });
    a.createBranch('feature/sparse', { fill: 'sparse' });

    a.useBranch('feature/sparse');
    a.update(conf.id,  { value: 'branch-conf' },  'test@example.com');
    a.update(clean.id, { value: 'branch-clean' }, 'test@example.com');

    a.useBranch('main');
    tick();
    a.update(conf.id, { value: 'main-conf' }, 'someone@else.com'); // only conf diverges

    const res = a.mergeBranchLocally('feature/sparse', { strategy: 'ours' });
    expect(res.merged).toBe(1);   // clean applied
    expect(res.skipped).toBe(1);  // conflicting skipped
    expect(a.get(clean.id)?.value).toBe('branch-clean');
    expect(a.get(conf.id)?.value).toBe('main-conf');
    cleanup(a);
  });
});

// ─── Merge blast radius (reverse-reference safety) ─────────────────────────────

describe('sparse branch merge blast radius', () => {
  test('surfaces referrers when a deleted item is still referenced (parentId)', () => {
    const { a, onMain, child } = withSparseBranch();
    a.delete(onMain.id, 'test@example.com'); // delete the parent; child still inherits parentId

    a.useBranch('main');
    const res = a.mergeBranchLocally('feature/sparse');
    const hit = res.blastRadius.find(b => b.id === onMain.id);
    expect(hit).toBeDefined();
    expect(hit.referencedBy.some(r => r.id === child.id && r.via === 'parent')).toBe(true);
    cleanup(a);
  });

  test('includes [[uuid]] backlinks in the blast radius', () => {
    const a      = tmpAdapter();
    const target = a.create({ value: 'target', type: 'text' });
    const linker = a.create({ value: `see [[${target.id}]]`, type: 'text' });
    a.createBranch('feature/sparse', { fill: 'sparse' });
    a.useBranch('feature/sparse');
    a.delete(target.id, 'test@example.com');

    a.useBranch('main');
    const res = a.mergeBranchLocally('feature/sparse');
    const hit = res.blastRadius.find(b => b.id === target.id);
    expect(hit?.referencedBy.some(r => r.id === linker.id && r.via === 'link')).toBe(true);
    cleanup(a);
  });

  test('blockOnBlastRadius aborts the merge and preserves the branch', () => {
    const { a, onMain } = withSparseBranch();
    a.delete(onMain.id, 'test@example.com');

    a.useBranch('main');
    let err;
    try { a.mergeBranchLocally('feature/sparse', { blockOnBlastRadius: true }); }
    catch (e) { err = e; }
    expect(err?.code).toBe('MERGE_BLAST_RADIUS');
    expect(err.blastRadius.map(b => b.id)).toContain(onMain.id);

    // Nothing applied; branch still present.
    expect(a.get(onMain.id)?.value).toBe('on main');
    expect(a.listBranches().map(b => b.name)).toContain('feature/sparse');
    cleanup(a);
  });

  test('no blast radius when the deleted item has no referrers', () => {
    const { a, child } = withSparseBranch();
    a.delete(child.id, 'test@example.com'); // a leaf — nothing points at it

    a.useBranch('main');
    const res = a.mergeBranchLocally('feature/sparse');
    expect(res.blastRadius).toEqual([]);
    cleanup(a);
  });

  test('a referrer that is also deleted in the same merge is not blast radius', () => {
    const { a, onMain, child } = withSparseBranch();
    a.delete(child.id, 'test@example.com');   // the only referrer of onMain…
    a.delete(onMain.id, 'test@example.com');  // …deleted alongside it

    a.useBranch('main');
    const res = a.mergeBranchLocally('feature/sparse');
    expect(res.blastRadius).toEqual([]); // no dangling reference is created
    cleanup(a);
  });
});
