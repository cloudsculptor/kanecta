'use strict';

import fs from 'fs';
import path from 'path';
import os from 'os';
import { SqliteFsAdapter } from '../src/adapter';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function tmpAdapter() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'kanecta-branch-'));
  return SqliteFsAdapter.init(root, 'test@example.com');
}

function cleanup(a) { fs.rmSync(a.root, { recursive: true, force: true }); }

// Resolve the on-disk item.json path for an item on a given branch.
function itemPathOn(a, branch, id) {
  const hex = id.replace(/-/g, '');
  return path.join(a.k, 'branches', branch, 'items', hex.slice(0, 2), hex.slice(2, 4), id, 'item.json');
}

// ─── Branch lifecycle ─────────────────────────────────────────────────────────

describe('branch lifecycle', () => {
  test('currentBranch() defaults to "main"', () => {
    const a = tmpAdapter();
    expect(a.currentBranch()).toBe('main');
    cleanup(a);
  });

  test('createBranch returns manifest with name, base, fill, createdAt — default fill is SPARSE', () => {
    const a = tmpAdapter();
    const b = a.createBranch('feature/foo');
    expect(b.name).toBe('feature/foo');
    expect(b.base).toBe('main');
    expect(b.fill).toBe('sparse'); // scale-correct default (spec «Branch operations»)
    expect(b.upstream).toEqual({ branch: 'main' });
    expect(b.createdAt).toBeTruthy();
    expect(() => a.createBranch('feature/bad', { fill: 'partial' })).toThrow(/Unknown fill/);
    cleanup(a);
  });

  test('createBranch creates a full self-contained branch folder', () => {
    const a   = tmpAdapter();
    a.createBranch('feature/foo', { fill: 'full' });
    const dir = path.join(a.k, 'branches', 'feature__foo');
    expect(fs.existsSync(dir)).toBe(true);
    expect(fs.existsSync(path.join(dir, 'branch.json'))).toBe(true);
    expect(fs.existsSync(path.join(dir, 'items'))).toBe(true);
    // index.db is copied from the base branch (full copy, not a delta).
    expect(fs.existsSync(path.join(dir, 'index.db'))).toBe(true);
    const manifest = JSON.parse(fs.readFileSync(path.join(dir, 'branch.json'), 'utf8'));
    expect(manifest.name).toBe('feature/foo');
    expect(manifest.fill).toBe('full');
    expect(manifest.upstream).toBeNull();
    cleanup(a);
  });

  test('createBranch is a full copy — base items appear in the new branch', () => {
    const a    = tmpAdapter();
    const item = a.create({ value: 'on main', type: 'text' });
    a.createBranch('feature/foo', { fill: 'full' });
    // Item file copied into the branch's own items/ tree.
    expect(fs.existsSync(itemPathOn(a, 'feature__foo', item.id))).toBe(true);
    a.switchBranch('feature/foo');
    expect(a.get(item.id)?.value).toBe('on main');
    cleanup(a);
  });

  test('createBranch encodes / as __ in directory name', () => {
    const a = tmpAdapter();
    a.createBranch('experiment/graph-viz');
    expect(fs.existsSync(path.join(a.k, 'branches', 'experiment__graph-viz'))).toBe(true);
    cleanup(a);
  });

  test('createBranch throws for duplicate name', () => {
    const a = tmpAdapter();
    a.createBranch('feature/foo');
    expect(() => a.createBranch('feature/foo')).toThrow('already exists');
    cleanup(a);
  });

  test('createBranch throws for name "main"', () => {
    const a = tmpAdapter();
    expect(() => a.createBranch('main')).toThrow();
    cleanup(a);
  });

  test('listBranches returns empty array when only main exists', () => {
    const a = tmpAdapter();
    expect(a.listBranches()).toEqual([]);
    cleanup(a);
  });

  test('listBranches reads branch.json from the branches/ directory', () => {
    const a = tmpAdapter();
    a.createBranch('feature/a');
    a.createBranch('feature/b');
    const list = a.listBranches();
    expect(list).toHaveLength(2);
    expect(list.map(b => b.name).sort()).toEqual(['feature/a', 'feature/b']);
    cleanup(a);
  });

  test('switchBranch changes currentBranch', () => {
    const a = tmpAdapter();
    a.createBranch('feature/foo');
    a.switchBranch('feature/foo');
    expect(a.currentBranch()).toBe('feature/foo');
    cleanup(a);
  });

  test('switchBranch opens the branch folder on reopen', () => {
    const a = tmpAdapter();
    a.createBranch('feature/foo');
    a.switchBranch('feature/foo');
    const item = a.create({ value: 'branch item', type: 'text' });
    // A fresh adapter on the same root + useBranch sees the branch's items.
    const b = SqliteFsAdapter.open(a.root);
    b.useBranch('feature/foo');
    expect(b.get(item.id)?.value).toBe('branch item');
    cleanup(a);
  });

  test('switchBranch back to main works', () => {
    const a = tmpAdapter();
    a.createBranch('feature/foo');
    a.switchBranch('feature/foo');
    a.switchBranch('main');
    expect(a.currentBranch()).toBe('main');
    cleanup(a);
  });

  test('switchBranch throws for non-existent branch', () => {
    const a = tmpAdapter();
    expect(() => a.switchBranch('feature/nonexistent')).toThrow('not found');
    cleanup(a);
  });

  test('deleteBranch removes branch from listBranches and deletes directory', () => {
    const a = tmpAdapter();
    a.createBranch('feature/to-delete');
    a.deleteBranch('feature/to-delete');
    expect(a.listBranches()).toHaveLength(0);
    expect(fs.existsSync(path.join(a.k, 'branches', 'feature__to-delete'))).toBe(false);
    cleanup(a);
  });

  test('deleteBranch throws when trying to delete active branch', () => {
    const a = tmpAdapter();
    a.createBranch('feature/foo');
    a.switchBranch('feature/foo');
    expect(() => a.deleteBranch('feature/foo')).toThrow('active branch');
    cleanup(a);
  });

  test('deleteBranch throws for main', () => {
    const a = tmpAdapter();
    expect(() => a.deleteBranch('main')).toThrow();
    cleanup(a);
  });
});

// ─── Branch write path (per-branch full folder — no overlays) ───────────────────

describe('branch write path', () => {
  test('create on branch writes item.json to the branch folder, not main', () => {
    const a = tmpAdapter();
    a.createBranch('feature/foo');
    a.switchBranch('feature/foo');
    const item = a.create({ value: 'branch item', type: 'text' });
    expect(fs.existsSync(itemPathOn(a, 'main', item.id))).toBe(false);
    expect(fs.existsSync(itemPathOn(a, 'feature__foo', item.id))).toBe(true);
    cleanup(a);
  });

  test('create on branch does not appear in the main index', () => {
    const a = tmpAdapter();
    a.createBranch('feature/foo');
    a.switchBranch('feature/foo');
    const item = a.create({ value: 'branch item', type: 'text' });
    a.switchBranch('main');
    expect(a.get(item.id)).toBeNull();
    cleanup(a);
  });

  test('update on branch is isolated — main keeps the original value on disk', () => {
    const a    = tmpAdapter();
    const main = a.create({ value: 'original', type: 'text' });
    a.createBranch('feature/foo');
    a.switchBranch('feature/foo');
    a.update(main.id, { value: 'modified on branch' });
    // Main item.json still has the original value.
    const mainDoc = JSON.parse(fs.readFileSync(itemPathOn(a, 'main', main.id), 'utf8'));
    expect(mainDoc.item.value).toBe('original');
    // Branch item.json has the new value.
    const branchDoc = JSON.parse(fs.readFileSync(itemPathOn(a, 'feature__foo', main.id), 'utf8'));
    expect(branchDoc.item.value).toBe('modified on branch');
    cleanup(a);
  });

  test('delete on branch of a copied item leaves main file intact', () => {
    const a    = tmpAdapter();
    const item = a.create({ value: 'to delete', type: 'text' });
    a.createBranch('feature/foo', { fill: 'full' });
    a.switchBranch('feature/foo');
    a.delete(item.id);
    // Removed from the branch folder, still present on main.
    expect(fs.existsSync(itemPathOn(a, 'feature__foo', item.id))).toBe(false);
    expect(fs.existsSync(itemPathOn(a, 'main', item.id))).toBe(true);
    cleanup(a);
  });
});

// ─── Branch read path ─────────────────────────────────────────────────────────

describe('branch read path', () => {
  test('get() on branch returns branch-created item', () => {
    const a = tmpAdapter();
    a.createBranch('feature/foo');
    a.switchBranch('feature/foo');
    const item = a.create({ value: 'branch item', type: 'text' });
    expect(a.get(item.id)).not.toBeNull();
    expect(a.get(item.id).value).toBe('branch item');
    cleanup(a);
  });

  test('get() on branch returns updated value for modified item', () => {
    const a    = tmpAdapter();
    const item = a.create({ value: 'original', type: 'text' });
    a.createBranch('feature/foo');
    a.switchBranch('feature/foo');
    a.update(item.id, { value: 'branch modified' });
    expect(a.get(item.id).value).toBe('branch modified');
    cleanup(a);
  });

  test('get() returns null for item deleted on branch', () => {
    const a    = tmpAdapter();
    const item = a.create({ value: 'to delete', type: 'text' });
    a.createBranch('feature/foo');
    a.switchBranch('feature/foo');
    a.delete(item.id);
    expect(a.get(item.id)).toBeNull();
    cleanup(a);
  });

  test('get() on main still returns item deleted on branch', () => {
    const a    = tmpAdapter();
    const item = a.create({ value: 'to delete', type: 'text' });
    a.createBranch('feature/foo');
    a.switchBranch('feature/foo');
    a.delete(item.id);
    a.switchBranch('main');
    expect(a.get(item.id)).not.toBeNull();
    cleanup(a);
  });

  test('get() on main still returns original value for item modified on branch', () => {
    const a    = tmpAdapter();
    const item = a.create({ value: 'original', type: 'text' });
    a.createBranch('feature/foo');
    a.switchBranch('feature/foo');
    a.update(item.id, { value: 'branch modified' });
    a.switchBranch('main');
    expect(a.get(item.id).value).toBe('original');
    cleanup(a);
  });

  test('children() on branch includes branch-created children', () => {
    const a      = tmpAdapter();
    const parent = a.create({ value: 'parent', type: 'text' });
    a.createBranch('feature/foo');
    a.switchBranch('feature/foo');
    const child = a.create({ value: 'branch child', type: 'text', parentId: parent.id });
    const kids  = a.children(parent.id);
    expect(kids.map(k => k.id)).toContain(child.id);
    cleanup(a);
  });

  test('children() on branch excludes items deleted on branch', () => {
    const a      = tmpAdapter();
    const parent = a.create({ value: 'parent', type: 'text' });
    const child  = a.create({ value: 'doomed', type: 'text', parentId: parent.id });
    a.createBranch('feature/foo');
    a.switchBranch('feature/foo');
    a.delete(child.id);
    const kids = a.children(parent.id);
    expect(kids.map(k => k.id)).not.toContain(child.id);
    cleanup(a);
  });

  test('children() on branch shows updated values for modified children', () => {
    const a      = tmpAdapter();
    const parent = a.create({ value: 'parent', type: 'text' });
    const child  = a.create({ value: 'original', type: 'text', parentId: parent.id });
    a.createBranch('feature/foo');
    a.switchBranch('feature/foo');
    a.update(child.id, { value: 'modified on branch' });
    const kids = a.children(parent.id);
    const found = kids.find(k => k.id === child.id);
    expect(found?.value).toBe('modified on branch');
    cleanup(a);
  });

  test('loadAll() on branch includes branch-created items', () => {
    const a   = tmpAdapter();
    a.createBranch('feature/foo');
    a.switchBranch('feature/foo');
    const item = a.create({ value: 'branch item', type: 'text' });
    const all  = a.loadAll();
    expect(all.map(i => i.id)).toContain(item.id);
    cleanup(a);
  });

  test('loadAll() on branch excludes items deleted on branch', () => {
    const a    = tmpAdapter();
    const item = a.create({ value: 'main item', type: 'text' });
    a.createBranch('feature/foo');
    a.switchBranch('feature/foo');
    a.delete(item.id);
    const all = a.loadAll();
    expect(all.map(i => i.id)).not.toContain(item.id);
    cleanup(a);
  });

  test('loadAll() on branch shows updated values for modified items', () => {
    const a    = tmpAdapter();
    const item = a.create({ value: 'original', type: 'text' });
    a.createBranch('feature/foo');
    a.switchBranch('feature/foo');
    a.update(item.id, { value: 'branch value' });
    const found = a.loadAll().find(i => i.id === item.id);
    expect(found?.value).toBe('branch value');
    cleanup(a);
  });

  test('switching branches clears memory cache', () => {
    const a    = tmpAdapter();
    const item = a.create({ value: 'original', type: 'text' });
    // Warm cache on main
    a.get(item.id);
    a.createBranch('feature/foo');
    a.switchBranch('feature/foo');
    a.update(item.id, { value: 'branch value' });
    // Switch back to main — cache was cleared, should see original
    a.switchBranch('main');
    expect(a.get(item.id).value).toBe('original');
    cleanup(a);
  });
});

// ─── branchDiff ───────────────────────────────────────────────────────────────

describe('branchDiff()', () => {
  test('empty diff when nothing changed', () => {
    const a = tmpAdapter();
    a.createBranch('feature/foo');
    const diff = a.branchDiff('feature/foo');
    expect(diff.adds).toHaveLength(0);
    expect(diff.edits).toHaveLength(0);
    expect(diff.deletes).toHaveLength(0);
    cleanup(a);
  });

  test('ADD appears in diff for branch-created items', () => {
    const a = tmpAdapter();
    a.createBranch('feature/foo');
    a.switchBranch('feature/foo');
    const item = a.create({ value: 'new', type: 'text' });
    const diff = a.branchDiff('feature/foo');
    expect(diff.adds.map(x => x.id)).toContain(item.id);
    cleanup(a);
  });

  test('EDIT appears in diff for modified items', () => {
    const a    = tmpAdapter();
    const item = a.create({ value: 'original', type: 'text' });
    a.createBranch('feature/foo');
    a.switchBranch('feature/foo');
    a.update(item.id, { value: 'modified' });
    const diff = a.branchDiff('feature/foo');
    expect(diff.edits.map(x => x.id)).toContain(item.id);
    expect(diff.edits.find(x => x.id === item.id).before.value).toBe('original');
    expect(diff.edits.find(x => x.id === item.id).after.value).toBe('modified');
    cleanup(a);
  });

  test('DELETE appears in diff for deleted items', () => {
    const a    = tmpAdapter();
    const item = a.create({ value: 'to delete', type: 'text' });
    a.createBranch('feature/foo');
    a.switchBranch('feature/foo');
    a.delete(item.id);
    const diff = a.branchDiff('feature/foo');
    expect(diff.deletes.map(x => x.id)).toContain(item.id);
    cleanup(a);
  });

  test('diff includes all three change types at once', () => {
    const a  = tmpAdapter();
    const e  = a.create({ value: 'edit me', type: 'text' });
    const d  = a.create({ value: 'delete me', type: 'text' });
    a.createBranch('feature/foo');
    a.switchBranch('feature/foo');
    const n  = a.create({ value: 'new', type: 'text' });
    a.update(e.id, { value: 'edited' });
    a.delete(d.id);
    const diff = a.branchDiff('feature/foo');
    expect(diff.adds.map(x => x.id)).toContain(n.id);
    expect(diff.edits.map(x => x.id)).toContain(e.id);
    expect(diff.deletes.map(x => x.id)).toContain(d.id);
    cleanup(a);
  });

  test('branchDiff on current branch when called without argument', () => {
    const a = tmpAdapter();
    a.createBranch('feature/foo');
    a.switchBranch('feature/foo');
    a.create({ value: 'new', type: 'text' });
    const diff = a.branchDiff(); // no arg — uses current branch
    expect(diff.adds).toHaveLength(1);
    cleanup(a);
  });

  test('branch-created item deleted on same branch does not appear in diff', () => {
    const a = tmpAdapter();
    a.createBranch('feature/foo');
    a.switchBranch('feature/foo');
    const item = a.create({ value: 'ephemeral', type: 'text' });
    a.delete(item.id);
    const diff = a.branchDiff('feature/foo');
    expect(diff.adds.map(x => x.id)).not.toContain(item.id);
    expect(diff.deletes.map(x => x.id)).not.toContain(item.id);
    cleanup(a);
  });
});

// ─── mergeBranchLocally ───────────────────────────────────────────────────────

describe('mergeBranchLocally()', () => {
  test('branch-created item appears in main after merge', () => {
    const a = tmpAdapter();
    a.createBranch('feature/foo');
    a.switchBranch('feature/foo');
    const item = a.create({ value: 'new', type: 'text' });
    a.switchBranch('main');
    a.mergeBranchLocally('feature/foo');
    expect(a.get(item.id)).not.toBeNull();
    expect(a.get(item.id).value).toBe('new');
    cleanup(a);
  });

  test('branch-updated item reflects new value in main after merge', () => {
    const a    = tmpAdapter();
    const item = a.create({ value: 'original', type: 'text' });
    a.createBranch('feature/foo');
    a.switchBranch('feature/foo');
    a.update(item.id, { value: 'updated' });
    a.switchBranch('main');
    a.mergeBranchLocally('feature/foo');
    expect(a.get(item.id).value).toBe('updated');
    cleanup(a);
  });

  test('branch-deleted item is gone from main after merge', () => {
    const a    = tmpAdapter();
    const item = a.create({ value: 'to delete', type: 'text' });
    a.createBranch('feature/foo');
    a.switchBranch('feature/foo');
    a.delete(item.id);
    a.switchBranch('main');
    a.mergeBranchLocally('feature/foo');
    expect(a.get(item.id)).toBeNull();
    cleanup(a);
  });

  test('merge removes the branch folder', () => {
    const a = tmpAdapter();
    a.createBranch('feature/foo');
    a.switchBranch('feature/foo');
    a.create({ value: 'x', type: 'text' });
    a.switchBranch('main');
    a.mergeBranchLocally('feature/foo');
    expect(fs.existsSync(path.join(a.k, 'branches', 'feature__foo'))).toBe(false);
    cleanup(a);
  });

  test('merge throws when trying to merge active branch', () => {
    const a = tmpAdapter();
    a.createBranch('feature/foo');
    a.switchBranch('feature/foo');
    expect(() => a.mergeBranchLocally('feature/foo')).toThrow('Switch to main');
    cleanup(a);
  });

  test('after merge the branch no longer exists', () => {
    const a = tmpAdapter();
    a.createBranch('feature/foo');
    a.switchBranch('feature/foo');
    a.create({ value: 'x', type: 'text' });
    a.switchBranch('main');
    a.mergeBranchLocally('feature/foo');
    expect(a.listBranches().map(b => b.name)).not.toContain('feature/foo');
    cleanup(a);
  });

  test('mergeBranchLocally returns count of merged changes', () => {
    const a = tmpAdapter();
    a.createBranch('feature/foo');
    a.switchBranch('feature/foo');
    a.create({ value: 'a', type: 'text' });
    a.create({ value: 'b', type: 'text' });
    a.switchBranch('main');
    const result = a.mergeBranchLocally('feature/foo');
    expect(result.merged).toBeGreaterThanOrEqual(2);
    cleanup(a);
  });
});

// ─── Multiple branches (true copies — fully independent) ────────────────────────

describe('multiple branches', () => {
  test('two branches are independent — changes on one do not affect the other', () => {
    const a = tmpAdapter();
    a.createBranch('feature/a');
    a.createBranch('feature/b');

    a.switchBranch('feature/a');
    const itemA = a.create({ value: 'branch a item', type: 'text' });

    a.switchBranch('feature/b');
    const itemB = a.create({ value: 'branch b item', type: 'text' });

    // On branch b: can see branch b's item, not branch a's
    expect(a.get(itemB.id)).not.toBeNull();
    expect(a.get(itemA.id)).toBeNull(); // not visible on branch b

    a.switchBranch('feature/a');
    // On branch a: can see branch a's item, not branch b's
    expect(a.get(itemA.id)).not.toBeNull();
    expect(a.get(itemB.id)).toBeNull(); // not visible on branch a
    cleanup(a);
  });

  test('a write on a branch does not appear on main and vice versa', () => {
    const a = tmpAdapter();
    a.createBranch('feature/foo', { fill: 'full' });

    a.switchBranch('feature/foo');
    const onBranch = a.create({ value: 'branch only', type: 'text' });

    a.switchBranch('main');
    const onMain = a.create({ value: 'main only', type: 'text' });
    expect(a.get(onBranch.id)).toBeNull();

    a.switchBranch('feature/foo');
    expect(a.get(onMain.id)).toBeNull();
    expect(a.get(onBranch.id)).not.toBeNull();
    cleanup(a);
  });

  test('branchDiff on specific branch name not affected by current branch', () => {
    const a = tmpAdapter();
    a.createBranch('feature/a');
    a.createBranch('feature/b');
    a.switchBranch('feature/a');
    a.create({ value: 'only on a', type: 'text' });
    a.switchBranch('feature/b'); // switch away from a
    const diffA = a.branchDiff('feature/a');
    const diffB = a.branchDiff('feature/b');
    expect(diffA.adds).toHaveLength(1);
    expect(diffB.adds).toHaveLength(0);
    cleanup(a);
  });
});
