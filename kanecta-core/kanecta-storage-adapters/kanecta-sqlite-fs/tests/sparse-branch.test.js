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
