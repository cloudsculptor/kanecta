'use strict';

import { vi } from 'vitest';
import { SyncEngine } from '../src/syncEngine.ts';

// ─── Mock factories ─────────────────────────────────────────────────────────

// Build a branchDiff-format entry from a flat item (as sqlite-fs adapter returns).
function toEntry(item, changeType) {
  const { id, value, type, parentId, aspect, sortOrder, ...meta } = item;
  return {
    id,
    after:  item,
    before: changeType === 'update' ? { ...item, value: 'old' } : null,
    doc: {
      item: { id, value, type, parentId, aspect: aspect ?? null, sortOrder: sortOrder ?? 0 },
      meta: {
        specVersion: meta.specVersion ?? '1.4.0',
        visibility:  meta.visibility  ?? 'private',
        tags:        meta.tags        ?? [],
        ...Object.fromEntries(Object.entries(meta).filter(([k]) =>
          ['owner','license','confidence','status','createdAt','modifiedAt',
           'createdBy','modifiedBy','expiresAt','deletedAt','connectorId',
           'materialized','sourceSystem','sourceExternalId'].includes(k)
        )),
      },
      search:  null,
      payload: item.payload ?? null,
      time:    item.time ?? {},
    },
  };
}

// Build a delete entry as branchDiff returns.
function toDeleteEntry(item) {
  return { id: item.id, before: item };
}

// Build a mock local (sqlite-fs) adapter.
// `diff` shape: { adds: BranchDiffEntry[], edits: BranchDiffEntry[], deletes: BranchDiffEntry[] }
function mockLocal({ diff = { adds: [], edits: [], deletes: [] } } = {}) {
  return {
    branchDiff: vi.fn().mockResolvedValue(diff),
  };
}

// Build a mock remote (Postgres) adapter.
function mockRemote({
  branch        = null,   // returned by getBranch
  createdBranch = null,   // returned by createBranch
  changes       = [],     // returned by getBranchChanges
  scan          = { blocked: false, blockingRefs: [], structuralRefs: [], summary: { adds: 0, edits: 0, deletes: 0 } },
  mergeResult   = { merged: 0, branchName: 'test' },
} = {}) {
  return {
    getBranch:           vi.fn().mockResolvedValue(branch),
    createBranch:        vi.fn().mockResolvedValue(createdBranch ?? { id: 'br-001', name: 'test', baseBranch: 'main', createdAt: new Date().toISOString() }),
    applyBranchChanges:  vi.fn().mockResolvedValue(undefined),
    getBranchChanges:    vi.fn().mockResolvedValue(changes),
    preFlightScan:       vi.fn().mockResolvedValue(scan),
    mergeBranch:         vi.fn().mockResolvedValue(mergeResult),
  };
}

const ITEM_A = {
  id: 'aaaa0001-0000-0000-0000-000000000001',
  value: 'Hello', type: 'text', parentId: '00000000-0000-0000-0000-000000000000',
  sortOrder: 0, specVersion: '1.4.0', visibility: 'private', tags: [],
  createdAt: '2026-06-27T00:00:00.000Z', modifiedAt: '2026-06-27T00:00:00.000Z',
};

const ITEM_B = {
  id: 'bbbb0001-0000-0000-0000-000000000001',
  value: 'World', type: 'text', parentId: '00000000-0000-0000-0000-000000000000',
  sortOrder: 1, specVersion: '1.4.0', visibility: 'private', tags: [],
  createdAt: '2026-06-27T00:00:00.000Z', modifiedAt: '2026-06-27T01:00:00.000Z',
};

// ─── SyncEngine.diff() ──────────────────────────────────────────────────────

describe('SyncEngine.diff()', () => {
  test('calls branchDiff on local adapter with the given branch name', async () => {
    const local  = mockLocal({ diff: { adds: [ITEM_A], edits: [], deletes: [] } });
    const result = await SyncEngine.diff(local, 'feature/foo');
    expect(local.branchDiff).toHaveBeenCalledWith('feature/foo');
    expect(result.adds).toHaveLength(1);
    expect(result.adds[0].id).toBe(ITEM_A.id);
  });

  test('includes branchName in returned result', async () => {
    const local  = mockLocal();
    const result = await SyncEngine.diff(local, 'my-branch');
    expect(result.branchName).toBe('my-branch');
  });

  test('returns empty adds/edits/deletes for a branch with no changes', async () => {
    const local  = mockLocal();
    const result = await SyncEngine.diff(local, 'empty-branch');
    expect(result.adds).toHaveLength(0);
    expect(result.edits).toHaveLength(0);
    expect(result.deletes).toHaveLength(0);
  });

  test('throws if local adapter does not implement branchDiff', async () => {
    const bad = {};
    await expect(SyncEngine.diff(bad, 'x')).rejects.toThrow(/branchDiff/);
  });

  test('propagates errors from branchDiff', async () => {
    const local = { branchDiff: vi.fn().mockRejectedValue(new Error('disk error')) };
    await expect(SyncEngine.diff(local, 'x')).rejects.toThrow('disk error');
  });
});

// ─── SyncEngine.push() ──────────────────────────────────────────────────────

describe('SyncEngine.push()', () => {
  test('creates the branch on the remote if it does not exist', async () => {
    const local  = mockLocal({ diff: { adds: [ITEM_A], edits: [], deletes: [] } });
    const remote = mockRemote({ branch: null });
    await SyncEngine.push(local, remote, 'feature/new');
    expect(remote.createBranch).toHaveBeenCalledWith('feature/new', {});
  });

  test('a new remote branch inherits the LOCAL fork watermark (branchPoint.at)', async () => {
    const local  = mockLocal({ diff: { adds: [ITEM_A], edits: [], deletes: [] } });
    (local as any).listBranches = vi.fn().mockResolvedValue([
      { name: 'feature/new', branchPoint: { branch: 'main', at: '2026-07-01T00:00:00.000Z' }, createdAt: '2026-07-02T00:00:00.000Z' },
    ]);
    const remote = mockRemote({ branch: null });
    await SyncEngine.push(local, remote, 'feature/new');
    expect(remote.createBranch).toHaveBeenCalledWith('feature/new', { branchPointAt: '2026-07-01T00:00:00.000Z' });
  });

  test('does not create the remote branch if it already exists', async () => {
    const existing = { id: 'br-existing', name: 'feature/existing' };
    const local    = mockLocal({ diff: { adds: [ITEM_A], edits: [], deletes: [] } });
    const remote   = mockRemote({ branch: existing });
    await SyncEngine.push(local, remote, 'feature/existing');
    expect(remote.createBranch).not.toHaveBeenCalled();
    expect(remote.applyBranchChanges).toHaveBeenCalledWith('br-existing', expect.any(Array));
  });

  test('converts add items to create change records', async () => {
    const local  = mockLocal({ diff: { adds: [ITEM_A], edits: [], deletes: [] } });
    const remote = mockRemote({ branch: null });
    await SyncEngine.push(local, remote, 'test');
    const [, changes] = remote.applyBranchChanges.mock.calls[0];
    const itemChange = changes.find(c => c.itemId === ITEM_A.id && c.section === 'item');
    expect(itemChange).toBeTruthy();
    expect(itemChange.changeType).toBe('create');
    expect(itemChange.data.value).toBe(ITEM_A.value);
  });

  test('converts edit items to update change records', async () => {
    const local  = mockLocal({ diff: { adds: [], edits: [ITEM_B], deletes: [] } });
    const remote = mockRemote({ branch: null });
    await SyncEngine.push(local, remote, 'test');
    const [, changes] = remote.applyBranchChanges.mock.calls[0];
    const itemChange = changes.find(c => c.itemId === ITEM_B.id && c.section === 'item');
    expect(itemChange).toBeTruthy();
    expect(itemChange.changeType).toBe('update');
  });

  test('converts deleted IDs to delete change records', async () => {
    const DEL_ID = 'cccc0001-0000-0000-0000-000000000001';
    const local  = mockLocal({ diff: { adds: [], edits: [], deletes: [DEL_ID] } });
    const remote = mockRemote({ branch: null });
    await SyncEngine.push(local, remote, 'test');
    const [, changes] = remote.applyBranchChanges.mock.calls[0];
    const delChange = changes.find(c => c.itemId === DEL_ID);
    expect(delChange).toBeTruthy();
    expect(delChange.changeType).toBe('delete');
    expect(delChange.section).toBe('item');
    expect(delChange.data).toBeNull();
  });

  test('emits meta section when item has provenance fields', async () => {
    const item = { ...ITEM_A, createdBy: 'personal@example.com', modifiedBy: 'personal@example.com' };
    const local  = mockLocal({ diff: { adds: [item], edits: [], deletes: [] } });
    const remote = mockRemote({ branch: null });
    await SyncEngine.push(local, remote, 'test');
    const [, changes] = remote.applyBranchChanges.mock.calls[0];
    const metaChange = changes.find(c => c.itemId === item.id && c.section === 'meta');
    expect(metaChange).toBeTruthy();
    expect(metaChange.data.createdBy).toBe('personal@example.com');
  });

  test('emits payload section when item has a payload', async () => {
    const item = { ...ITEM_A, payload: { foo: 'bar' } };
    const local  = mockLocal({ diff: { adds: [item], edits: [], deletes: [] } });
    const remote = mockRemote({ branch: null });
    await SyncEngine.push(local, remote, 'test');
    const [, changes] = remote.applyBranchChanges.mock.calls[0];
    const payChange = changes.find(c => c.itemId === item.id && c.section === 'payload');
    expect(payChange).toBeTruthy();
    expect(payChange.data).toMatchObject({ foo: 'bar' });
  });

  test('skips applyBranchChanges when diff is empty', async () => {
    const local  = mockLocal({ diff: { adds: [], edits: [], deletes: [] } });
    const remote = mockRemote({ branch: null });
    const result = await SyncEngine.push(local, remote, 'test');
    expect(remote.applyBranchChanges).not.toHaveBeenCalled();
    expect(result.pushed).toBe(0);
  });

  test('returns branchId and pushed count', async () => {
    const local  = mockLocal({ diff: { adds: [ITEM_A], edits: [ITEM_B], deletes: [] } });
    const remote = mockRemote({ branch: null });
    const result = await SyncEngine.push(local, remote, 'test');
    expect(result.branchId).toBe('br-001');
    expect(result.pushed).toBeGreaterThan(0);
  });

  test('handles mixed adds + edits + deletes in one push', async () => {
    const DEL_ID = 'dddd0001-0000-0000-0000-000000000001';
    const local  = mockLocal({ diff: { adds: [ITEM_A], edits: [ITEM_B], deletes: [DEL_ID] } });
    const remote = mockRemote({ branch: null });
    const result = await SyncEngine.push(local, remote, 'test');
    const [, changes] = remote.applyBranchChanges.mock.calls[0];
    const types = new Set(changes.map(c => c.changeType));
    expect(types.has('create')).toBe(true);
    expect(types.has('update')).toBe(true);
    expect(types.has('delete')).toBe(true);
    expect(result.pushed).toBeGreaterThan(0);
  });

  test('throws if local adapter lacks branchDiff', async () => {
    await expect(SyncEngine.push({}, mockRemote(), 'x')).rejects.toThrow(/branchDiff/);
  });

  test('throws if remote adapter lacks applyBranchChanges', async () => {
    const local  = mockLocal();
    const remote = { getBranch: vi.fn().mockResolvedValue(null), createBranch: vi.fn().mockResolvedValue({ id: 'x', name: 'x' }) };
    await expect(SyncEngine.push(local, remote, 'x')).rejects.toThrow(/applyBranchChanges/);
  });
});

// ─── SyncEngine.preFlightScan() ─────────────────────────────────────────────

describe('SyncEngine.preFlightScan()', () => {
  test('delegates to remoteAdapter.preFlightScan with branchId', async () => {
    const br     = { id: 'br-123', name: 'scan-target' };
    const remote = mockRemote({ branch: br });
    await SyncEngine.preFlightScan(remote, 'scan-target');
    expect(remote.preFlightScan).toHaveBeenCalledWith('br-123');
  });

  test('returns the scan result from the remote adapter', async () => {
    const br   = { id: 'br-abc', name: 'x' };
    const scan = { blocked: false, blockingRefs: [], summary: { adds: 1, edits: 0, deletes: 0 } };
    const remote = mockRemote({ branch: br, scan });
    const result = await SyncEngine.preFlightScan(remote, 'x');
    expect(result.blocked).toBe(false);
    expect(result.summary.adds).toBe(1);
  });

  test('throws if branch does not exist on remote', async () => {
    const remote = mockRemote({ branch: null });
    await expect(SyncEngine.preFlightScan(remote, 'ghost')).rejects.toThrow(/not found/);
  });

  test('throws if remote adapter lacks preFlightScan', async () => {
    const bad = { getBranch: vi.fn().mockResolvedValue({ id: 'x' }) };
    await expect(SyncEngine.preFlightScan(bad, 'x')).rejects.toThrow(/preFlightScan/);
  });
});

// ─── SyncEngine.merge() ─────────────────────────────────────────────────────

describe('SyncEngine.merge()', () => {
  test('runs preFlightScan and then calls mergeBranch', async () => {
    const br     = { id: 'br-merge', name: 'merge-me' };
    const remote = mockRemote({ branch: br, mergeResult: { merged: 2, branchName: 'merge-me' } });
    const result = await SyncEngine.merge(remote, 'merge-me');
    expect(remote.preFlightScan).toHaveBeenCalledWith('br-merge');
    expect(remote.mergeBranch).toHaveBeenCalledWith('br-merge', { strategy: null, blockOnBlastRadius: false });
    expect(result.merged).toBe(2);
  });

  test('throws if scan is blocked and force is false', async () => {
    const br     = { id: 'br-blocked', name: 'blocked' };
    const scan   = { blocked: true, blockingRefs: [{ referenceItemId: 'ref-001' }], summary: { adds: 0, edits: 0, deletes: 1 } };
    const remote = mockRemote({ branch: br, scan });
    await expect(SyncEngine.merge(remote, 'blocked')).rejects.toThrow(/Merge blocked/);
    expect(remote.mergeBranch).not.toHaveBeenCalled();
  });

  test('proceeds past a blocked scan when force is true', async () => {
    const br     = { id: 'br-force', name: 'force-merge' };
    const scan   = { blocked: true, blockingRefs: [{ referenceItemId: 'ref-002' }], summary: { adds: 0, edits: 0, deletes: 1 } };
    const remote = mockRemote({ branch: br, scan, mergeResult: { merged: 1, branchName: 'force-merge' } });
    const result = await SyncEngine.merge(remote, 'force-merge', { force: true });
    expect(remote.mergeBranch).toHaveBeenCalled();
    expect(result.merged).toBe(1);
  });

  test('skips preFlightScan when force is true', async () => {
    const br     = { id: 'br-skip', name: 'skip-scan' };
    const remote = mockRemote({ branch: br, mergeResult: { merged: 0, branchName: 'skip-scan' } });
    await SyncEngine.merge(remote, 'skip-scan', { force: true });
    expect(remote.preFlightScan).not.toHaveBeenCalled();
  });

  test('throws if branch does not exist on remote', async () => {
    const remote = mockRemote({ branch: null });
    await expect(SyncEngine.merge(remote, 'ghost')).rejects.toThrow(/not found/);
  });

  test('throws if remote adapter lacks mergeBranch', async () => {
    const bad = {
      getBranch:     vi.fn().mockResolvedValue({ id: 'x' }),
      preFlightScan: vi.fn().mockResolvedValue({ blocked: false, blockingRefs: [] }),
    };
    await expect(SyncEngine.merge(bad, 'x')).rejects.toThrow(/mergeBranch/);
  });
});

// ─── SyncEngine.fullSync() ──────────────────────────────────────────────────

describe('SyncEngine.fullSync()', () => {
  test('runs diff → push → preFlightScan → merge and returns all results', async () => {
    const br     = { id: 'br-full', name: 'full-sync-branch' };
    const local  = mockLocal({ diff: { adds: [ITEM_A], edits: [], deletes: [] } });
    const remote = mockRemote({ branch: null, createdBranch: br, mergeResult: { merged: 1, branchName: 'full-sync-branch' } });

    // After createBranch, getBranch should return the branch
    remote.getBranch
      .mockResolvedValueOnce(null)          // first call in push() → branch doesn't exist
      .mockResolvedValueOnce(br)            // second call in preFlightScan()
      .mockResolvedValueOnce(br);           // third call in merge()

    const result = await SyncEngine.fullSync(local, remote, 'full-sync-branch');

    expect(result.diff.adds).toHaveLength(1);
    expect(result.push.pushed).toBeGreaterThan(0);
    expect(result.scan.blocked).toBe(false);
    expect(result.merge.merged).toBe(1);
  });

  test('throws at fullSync if scan is blocked', async () => {
    const br     = { id: 'br-block', name: 'blocked-sync' };
    const local  = mockLocal({ diff: { adds: [], edits: [], deletes: ['del-001'] } });
    const remote = mockRemote({
      branch: null,
      scan: { blocked: true, blockingRefs: [{ referenceItemId: 'ref-x' }], summary: { adds: 0, edits: 0, deletes: 1 } },
    });
    remote.getBranch.mockResolvedValue(br);

    await expect(SyncEngine.fullSync(local, remote, 'blocked-sync')).rejects.toThrow(/blocked/);
    expect(remote.mergeBranch).not.toHaveBeenCalled();
  });

  test('fullSync with force:true proceeds past blocked scan', async () => {
    const br     = { id: 'br-force-full', name: 'force-full' };
    const local  = mockLocal({ diff: { adds: [ITEM_A], edits: [], deletes: [] } });
    const remote = mockRemote({
      branch: null,
      createdBranch: br,
      scan: { blocked: true, blockingRefs: [{ referenceItemId: 'ref-y' }], summary: { adds: 1, edits: 0, deletes: 0 } },
      mergeResult: { merged: 1, branchName: 'force-full' },
    });
    remote.getBranch
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(br)
      .mockResolvedValueOnce(br);

    const result = await SyncEngine.fullSync(local, remote, 'force-full', { force: true });
    expect(result.merge.merged).toBe(1);
  });

  test('empty diff still pushes and merges (no-op merge)', async () => {
    const br     = { id: 'br-noop', name: 'noop-sync' };
    const local  = mockLocal({ diff: { adds: [], edits: [], deletes: [] } });
    const remote = mockRemote({ branch: null, createdBranch: br, mergeResult: { merged: 0, branchName: 'noop-sync' } });
    remote.getBranch
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(br)
      .mockResolvedValueOnce(br);

    const result = await SyncEngine.fullSync(local, remote, 'noop-sync');
    expect(result.push.pushed).toBe(0);
    expect(result.merge.merged).toBe(0);
  });
});

// ─── _itemToChanges internal (via push) ─────────────────────────────────────

describe('_itemToChanges coverage (via push)', () => {
  test('item with search section emits search change record', async () => {
    const item = { ...ITEM_A, search: { keywords: ['hello'], fullText: 'hello world' } };
    const local  = mockLocal({ diff: { adds: [item], edits: [], deletes: [] } });
    const remote = mockRemote({ branch: null });
    await SyncEngine.push(local, remote, 'test');
    const [, changes] = remote.applyBranchChanges.mock.calls[0];
    const searchChange = changes.find(c => c.section === 'search');
    expect(searchChange).toBeTruthy();
    expect(searchChange.data.keywords).toContain('hello');
  });

  test('item with time section emits time change record', async () => {
    const item = { ...ITEM_A, time: { dueAt: '2026-12-31T00:00:00.000Z' } };
    const local  = mockLocal({ diff: { adds: [item], edits: [], deletes: [] } });
    const remote = mockRemote({ branch: null });
    await SyncEngine.push(local, remote, 'test');
    const [, changes] = remote.applyBranchChanges.mock.calls[0];
    const timeChange = changes.find(c => c.section === 'time');
    expect(timeChange).toBeTruthy();
    expect(timeChange.data.dueAt).toBe('2026-12-31T00:00:00.000Z');
  });

  test('item without optional sections does not emit empty records', async () => {
    const item = { id: ITEM_A.id, value: 'bare', type: 'text', parentId: ITEM_A.parentId, sortOrder: 0 };
    const local  = mockLocal({ diff: { adds: [item], edits: [], deletes: [] } });
    const remote = mockRemote({ branch: null });
    await SyncEngine.push(local, remote, 'test');
    const [, changes] = remote.applyBranchChanges.mock.calls[0];
    // Only 'item' section — no meta, search, payload, time
    expect(changes).toHaveLength(1);
    expect(changes[0].section).toBe('item');
  });

  test('item with aspect field is included in item section data', async () => {
    const item = { ...ITEM_A, aspect: 'tasks' };
    const local  = mockLocal({ diff: { adds: [item], edits: [], deletes: [] } });
    const remote = mockRemote({ branch: null });
    await SyncEngine.push(local, remote, 'test');
    const [, changes] = remote.applyBranchChanges.mock.calls[0];
    const itemChange = changes.find(c => c.section === 'item');
    expect(itemChange.data.aspect).toBe('tasks');
  });
});
