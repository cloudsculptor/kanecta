'use strict';

import fs from 'fs';
import path from 'path';
import os from 'os';
import { SqliteFsAdapter, ROOT_ID } from '../src/adapter';

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

  test('flags a branch edit of an item deleted upstream — no silent resurrection', () => {
    const a = tmpAdapter();
    const x = a.create({ value: 'x0', type: 'text' });
    a.createBranch('feature/sparse', { fill: 'sparse' });

    // Branch keeps/edits x (materialises it locally).
    a.useBranch('feature/sparse');
    a.update(x.id, { value: 'branch edit of x' }, 'test@example.com');

    // Upstream deletes x after the fork.
    a.useBranch('main');
    a.delete(x.id, 'someone@else.com');

    const preview = a.previewMerge('feature/sparse');
    const c = preview.conflicts.find(c => c.id === x.id);
    expect(c?.kind).toBe('add-delete');

    // Default merge aborts rather than resurrect x…
    let err;
    try { a.mergeBranchLocally('feature/sparse'); } catch (e) { err = e; }
    expect(err?.code).toBe('MERGE_CONFLICT');

    // …and 'ours' respects the upstream deletion (x stays gone).
    const res = a.mergeBranchLocally('feature/sparse', { strategy: 'ours' });
    expect(a.get(x.id)).toBeNull();
    expect(res.skipped).toBeGreaterThanOrEqual(1);
    cleanup(a);
  });

  test('a genuine branch-only add (created after the fork) is NOT a conflict', () => {
    const { a } = withSparseBranch();
    const added = a.create({ value: 'brand new', type: 'text' });
    const preview = a.previewMerge('feature/sparse');
    expect(preview.adds.map(x => x.id)).toContain(added.id);
    expect(preview.conflicts.map(c => c.id)).not.toContain(added.id);
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

  test('includes aliases that target a deleted item', () => {
    const a      = tmpAdapter();
    const target = a.create({ value: 'aliased target', type: 'text' });
    a.setAlias('my-alias', target.id);
    a.createBranch('feature/sparse', { fill: 'sparse' });
    a.useBranch('feature/sparse');
    a.delete(target.id, 'test@example.com');

    a.useBranch('main');
    const res = a.mergeBranchLocally('feature/sparse');
    const hit = res.blastRadius.find(b => b.id === target.id);
    expect(hit?.referencedBy.some(r => r.via === 'alias')).toBe(true);
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

// ─── Reverse blast radius — danglingRefs ──────────────────────────────────────
// The forward blastRadius scans referrers of branch DELETES; danglingRefs is
// the mirror: branch adds/edits whose OUTBOUND refs (parent, [[uuid]] link,
// payload target/source) point at an item that will not exist after the merge.

describe('reverse blast radius — danglingRefs', () => {
  test('an edit linking to an item the same branch deletes is flagged; gate blocks the merge', () => {
    const { a, onMain, child } = withSparseBranch();
    a.delete(child.id); // tombstone on the sparse branch
    a.update(onMain.id, { value: `see [[${child.id}]]` });
    a.useBranch('main');

    const preview = a.previewMerge('feature/sparse');
    expect(preview.danglingRefs).toEqual([
      { id: onMain.id, refs: [{ targetId: child.id, via: 'link' }] },
    ]);

    expect(() => a.mergeBranchLocally('feature/sparse', { blockOnDanglingRefs: true }))
      .toThrow(/will not exist after the merge/);
    try { a.mergeBranchLocally('feature/sparse', { blockOnDanglingRefs: true }); }
    catch (err) {
      expect(err.code).toBe('MERGE_DANGLING_REFS');
      expect(err.danglingRefs[0].id).toBe(onMain.id);
    }
    // Branch preserved by the gate.
    expect(a.listBranches().map(b => b.name)).toContain('feature/sparse');
    cleanup(a);
  });

  test('a branch add under a parent deleted upstream after the fork is flagged as via:parent', () => {
    const a = tmpAdapter();
    const standalone = a.create({ value: 'doomed parent', type: 'text' });
    a.createBranch('feature/sparse', { fill: 'sparse' });
    a.useBranch('feature/sparse');
    const added = a.create({ value: 'orphan-to-be', type: 'text', parentId: standalone.id });

    a.useBranch('main');
    tick();
    a.delete(standalone.id); // upstream deletes the parent after the fork

    const preview = a.previewMerge('feature/sparse');
    expect(preview.danglingRefs).toEqual([
      { id: added.id, refs: [{ targetId: standalone.id, via: 'parent' }] },
    ]);
    cleanup(a);
  });

  test('refs satisfied by the branch\'s own adds are NOT flagged', () => {
    const a = tmpAdapter();
    a.createBranch('feature/sparse', { fill: 'sparse' });
    a.useBranch('feature/sparse');
    const parent = a.create({ value: 'new parent', type: 'text' });
    const child  = a.create({ value: `child of [[${parent.id}]]`, type: 'text', parentId: parent.id });

    a.useBranch('main');
    const preview = a.previewMerge('feature/sparse');
    expect(preview.danglingRefs).toEqual([]);
    expect(preview.adds.map(x => x.id).sort()).toEqual([parent.id, child.id].sort());

    const result = a.mergeBranchLocally('feature/sparse', { blockOnDanglingRefs: true });
    expect(result.merged).toBe(2);
    expect(result.danglingRefs).toEqual([]);
    cleanup(a);
  });
});

// ─── Content-fingerprint conflict detection (bases.json) ──────────────────────
// The durable, clock-free mechanism (owner decision 2026-07-18): materialising
// an upstream item on a sparse branch records a sha256 of the base doc; merge
// compares the CURRENT upstream doc's content hash to that base hash. The
// timestamp watermark remains the fallback for items without a fingerprint.

describe('sparse branch base fingerprints', () => {
  test('materialising an edit records the base fingerprint in bases.json', () => {
    const { a, onMain } = withSparseBranch();
    a.update(onMain.id, { value: 'edited on branch' });

    const bases = JSON.parse(
      fs.readFileSync(path.join(a.k, 'branches', 'feature__sparse', 'bases.json'), 'utf8'));
    expect(bases[onMain.id].sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(bases[onMain.id].modifiedAt).toBeTruthy();
    cleanup(a);
  });

  test('upstream touched-then-REVERTED reads clean under the fingerprint (timestamps would flag it)', () => {
    const { a, onMain } = withSparseBranch();
    a.update(onMain.id, { value: 'edited on branch' });

    // Upstream: change the value, then change it back. modifiedAt has moved
    // past the watermark (the old check would cry conflict) but the CONTENT is
    // identical to the branch's base.
    a.useBranch('main');
    tick();
    a.update(onMain.id, { value: 'temporarily different' });
    tick();
    a.update(onMain.id, { value: 'on main' });

    const preview = a.previewMerge('feature/sparse');
    expect(preview.conflicts).toEqual([]);
    const result = a.mergeBranchLocally('feature/sparse');
    expect(result.merged).toBe(1);
    expect(a.get(onMain.id).value).toBe('edited on branch');
    cleanup(a);
  });

  test('a REAL upstream content change still conflicts under the fingerprint', () => {
    const { a, onMain } = withSparseBranch();
    a.update(onMain.id, { value: 'edited on branch' });

    a.useBranch('main');
    tick();
    a.update(onMain.id, { value: 'moved on main' });

    const preview = a.previewMerge('feature/sparse');
    expect(preview.conflicts).toHaveLength(1);
    expect(preview.conflicts[0].kind).toBe('edit-edit');
    expect(() => a.mergeBranchLocally('feature/sparse')).toThrow(/conflict/);
    cleanup(a);
  });

  test('a tombstone delete records the base too — delete-edit via content hash', () => {
    const { a, child } = withSparseBranch();
    a.delete(child.id); // tombstone on the branch → base fingerprint captured

    const bases = JSON.parse(
      fs.readFileSync(path.join(a.k, 'branches', 'feature__sparse', 'bases.json'), 'utf8'));
    expect(bases[child.id].sha256).toMatch(/^[0-9a-f]{64}$/);

    a.useBranch('main');
    tick();
    a.update(child.id, { value: 'edited after branch deleted it' });

    const preview = a.previewMerge('feature/sparse');
    expect(preview.conflicts).toHaveLength(1);
    expect(preview.conflicts[0].kind).toBe('delete-edit');
    cleanup(a);
  });

  test('genuine branch adds never get a fingerprint (nothing upstream to base on)', () => {
    const { a } = withSparseBranch();
    a.create({ value: 'born on branch', type: 'text' });
    const basesPath = path.join(a.k, 'branches', 'feature__sparse', 'bases.json');
    if (fs.existsSync(basesPath)) {
      const bases = JSON.parse(fs.readFileSync(basesPath, 'utf8'));
      expect(Object.keys(bases)).toHaveLength(0);
    }
    cleanup(a);
  });
});
