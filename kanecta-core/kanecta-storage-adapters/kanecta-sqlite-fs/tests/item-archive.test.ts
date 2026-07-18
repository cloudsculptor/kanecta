'use strict';

// item_archive — soft delete as a physical move (spec §item_archive draft).
// A soft delete moves the ENTIRE item folder items/ → archive/ (sidecars
// included), stamps deletedAt, and mirrors the envelope into schema-identical
// item_archive* index twins; live queries then never see deleted items by
// construction. Point reads by id resolve the archive transparently (restore
// tooling / file proxies); includeDeleted unions the archive back in; hard
// delete of an archived item purges it. The twins' schemas are DERIVED from
// the live tables' DDL, and the drift test here is the enforcement mechanism
// for the spec's primary constraint: items* and item_archive* stay identical.

import fs from 'fs';
import path from 'path';
import os from 'os';
import { SqliteFsAdapter } from '../src/adapter';

const OWNER = 'test@example.com';

function tmpAdapter() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'kanecta-arch-'));
  return SqliteFsAdapter.init(root, OWNER);
}
function cleanup(a: any) { fs.rmSync(a.root, { recursive: true, force: true }); }

const liveDir    = (a: any, id: string) => a._itemDir(id, 'items');
const archiveDir = (a: any, id: string) => a._itemDir(id, 'archive');

describe('schema: item_archive twins', () => {
  it('every items* table has a column-identical item_archive* twin (drift gate)', () => {
    const a = tmpAdapter();
    const db = a._openDb();
    for (const [live, twin] of SqliteFsAdapter.ARCHIVE_TWINS) {
      expect(a._archiveColumns(db, twin)).toEqual(a._archiveColumns(db, live));
      expect(a._archiveColumns(db, twin).length).toBeGreaterThan(0);
    }
    cleanup(a);
  });

  it('a drifted twin self-heals to the live DDL on reopen', () => {
    const a = tmpAdapter();
    const db = a._openDb();
    db.exec('DROP TABLE item_archive_search');
    db.exec('CREATE TABLE item_archive_search (item_id TEXT PRIMARY KEY, stale_col TEXT)');
    a._ensureArchiveSchema(db);
    expect(a._archiveColumns(db, 'item_archive_search')).toEqual(a._archiveColumns(db, 'items_search'));
    cleanup(a);
  });
});

describe('softDelete = physical move to archive/', () => {
  it('moves the whole folder (sidecars included) and stamps deletedAt', () => {
    const a = tmpAdapter();
    const item = a.create({ value: 'doomed', type: 'text', owner: OWNER });
    a.putFile(item.id, 'attachment.bin', Buffer.from('bytes'));

    const res = a.softDelete(item.id);
    expect(res.deletedAt).toBeTruthy();

    expect(fs.existsSync(liveDir(a, item.id))).toBe(false);
    expect(fs.existsSync(path.join(archiveDir(a, item.id), 'item.json'))).toBe(true);
    expect(fs.existsSync(path.join(archiveDir(a, item.id), 'attachment.bin'))).toBe(true);

    const archived = JSON.parse(fs.readFileSync(path.join(archiveDir(a, item.id), 'item.json'), 'utf8'));
    expect(archived.meta.deletedAt).toBe(res.deletedAt);
    cleanup(a);
  });

  it('the live index physically loses the item; the archive twins gain it', () => {
    const a = tmpAdapter();
    const item = a.create({ value: 'gone from live', type: 'text', owner: OWNER, tags: ['t1'] });
    a.softDelete(item.id);
    const db = a._openDb();
    expect(db.prepare('SELECT 1 FROM items WHERE id = ?').get(item.id)).toBeUndefined();
    expect(db.prepare('SELECT 1 FROM items_meta WHERE item_id = ?').get(item.id)).toBeUndefined();
    expect(db.prepare('SELECT 1 FROM item_archive WHERE id = ?').get(item.id)).toBeTruthy();
    const meta: any = db.prepare('SELECT deleted_at FROM item_archive_meta WHERE item_id = ?').get(item.id);
    expect(meta.deleted_at).toBeTruthy();
    // Derived read accelerators no longer carry the item.
    expect(db.prepare('SELECT 1 FROM perf_search WHERE item_id = ?').get(item.id)).toBeUndefined();
    expect(db.prepare('SELECT 1 FROM perf_tags WHERE item_id = ?').get(item.id)).toBeUndefined();
    cleanup(a);
  });

  it('is idempotent on an already-archived item', () => {
    const a = tmpAdapter();
    const item = a.create({ value: 'twice', type: 'text', owner: OWNER });
    const first = a.softDelete(item.id);
    const second = a.softDelete(item.id);
    expect(second.deletedAt).toBe(first.deletedAt);
    cleanup(a);
  });

  it('does not cascade: children stay live under an archived parent', () => {
    const a = tmpAdapter();
    const parent = a.create({ value: 'folder', type: 'text', owner: OWNER });
    const child  = a.create({ value: 'kept', type: 'text', parentId: parent.id, owner: OWNER });
    a.softDelete(parent.id);
    expect(a.get(child.id).deletedAt).toBeNull();
    expect(fs.existsSync(liveDir(a, child.id))).toBe(true);
    cleanup(a);
  });
});

describe('point reads resolve the archive; set reads never do', () => {
  it('get(id) returns the archived item with deletedAt set', () => {
    const a = tmpAdapter();
    const item = a.create({ value: 'findable', type: 'text', owner: OWNER });
    a.softDelete(item.id);
    const got = a.get(item.id);
    expect(got).toBeTruthy();
    expect(got.deletedAt).toBeTruthy();
    expect(got.value).toBe('findable');
    cleanup(a);
  });

  it('getFile keeps serving bytes for an archived item (file-proxy contract)', () => {
    const a = tmpAdapter();
    const item = a.create({ value: 'image holder', type: 'text', owner: OWNER });
    a.putFile(item.id, 'photo.png', Buffer.from('png-bytes'));
    a.softDelete(item.id);
    expect(a.getFile(item.id, 'photo.png')).toEqual(Buffer.from('png-bytes'));
    expect(a.listFiles(item.id)).toEqual(['photo.png']);
    cleanup(a);
  });

  it('query/loadAll/children exclude archived items without any filter', () => {
    const a = tmpAdapter();
    const item = a.create({ value: 'excluded-by-construction', type: 'text', owner: OWNER });
    a.softDelete(item.id);
    expect(a.query({ limit: 0 }).some((i: any) => i.id === item.id)).toBe(false);
    expect(a.loadAll().some((i: any) => i.id === item.id)).toBe(false);
    expect(a.children(item.parentId).some((i: any) => i.id === item.id)).toBe(false);
    cleanup(a);
  });

  it('query({ includeDeleted: true }) unions the archive in', () => {
    const a = tmpAdapter();
    const item = a.create({ value: 'recoverable', type: 'text', owner: OWNER });
    a.softDelete(item.id);
    const rows = a.query({ includeDeleted: true, limit: 0 });
    const hit = rows.find((i: any) => i.id === item.id);
    expect(hit).toBeTruthy();
    expect(hit.deletedAt).toBeTruthy();
    cleanup(a);
  });

  it('loadAll({ includeDeleted: true }) unions the archive in', () => {
    const a = tmpAdapter();
    const item = a.create({ value: 'in the union', type: 'text', owner: OWNER });
    a.softDelete(item.id);
    expect(a.loadAll({ includeDeleted: true }).some((i: any) => i.id === item.id)).toBe(true);
    cleanup(a);
  });

  it('update() refuses archived items and flag-style deletedAt changes', () => {
    const a = tmpAdapter();
    const item = a.create({ value: 'immutable while archived', type: 'text', owner: OWNER });
    a.softDelete(item.id);
    expect(() => a.update(item.id, { value: 'nope' })).toThrow(/archived/);
    const live = a.create({ value: 'live', type: 'text', owner: OWNER });
    expect(() => a.update(live.id, { deletedAt: new Date().toISOString() })).toThrow(/softDelete/);
    cleanup(a);
  });
});

describe('restore = move back out of the archive', () => {
  it('round-trips: folder returns, derived rows repopulate, queries see it again', () => {
    const a = tmpAdapter();
    const { metadata: t } = a.createType('ArchThing', { icon: 'Category' });
    const item = a.create({
      value: 'phoenix [[00000000-0000-0000-0000-000000000000]]', type: 'object', typeId: t.id,
      owner: OWNER, tags: ['reborn'], objectData: { name: 'p1' },
    });
    a.putFile(item.id, 'wing.bin', Buffer.from('feathers'));
    a.softDelete(item.id);

    const res = a.restore(item.id);
    expect(res.deletedAt).toBeNull();

    expect(fs.existsSync(path.join(liveDir(a, item.id), 'item.json'))).toBe(true);
    expect(fs.existsSync(path.join(liveDir(a, item.id), 'wing.bin'))).toBe(true);
    expect(fs.existsSync(archiveDir(a, item.id))).toBe(false);

    const db = a._openDb();
    expect(db.prepare('SELECT 1 FROM items WHERE id = ?').get(item.id)).toBeTruthy();
    expect(db.prepare('SELECT 1 FROM item_archive WHERE id = ?').get(item.id)).toBeUndefined();
    expect(db.prepare('SELECT 1 FROM perf_tags WHERE item_id = ? AND tag = ?').get(item.id, 'reborn')).toBeTruthy();
    expect(db.prepare('SELECT 1 FROM perf_search WHERE item_id = ?').get(item.id)).toBeTruthy();
    // The obj_ projection row is back with its payload.
    expect(a.readObjectJson(item.id)).toMatchObject({ name: 'p1' });
    expect(a.query({ type: 'ArchThing', limit: 0 }).some((i: any) => i.id === item.id)).toBe(true);
    cleanup(a);
  });

  it('keeps the type table while the LAST instance sits in the archive (spec rule)', () => {
    const a = tmpAdapter();
    const { metadata: t } = a.createType('LastOne', { icon: 'Category' });
    const item = a.create({ value: 'only', type: 'object', typeId: t.id, owner: OWNER, objectData: { name: 'solo' } });
    const table = `obj_${t.id.replace(/-/g, '_')}`;
    const db = a._openDb();
    a.softDelete(item.id);
    expect(db.prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name = ?`).get(table)).toBeTruthy();
    a.restore(item.id);
    expect(db.prepare(`SELECT 1 FROM "${table}" WHERE item_id = ?`).get(item.id)).toBeTruthy();
    cleanup(a);
  });
});

describe('hard delete of an archived item = purge', () => {
  it('removes the archive copy and its index rows for good', () => {
    const a = tmpAdapter();
    const item = a.create({ value: 'purge me', type: 'text', owner: OWNER });
    a.softDelete(item.id);
    a.delete(item.id);
    expect(fs.existsSync(archiveDir(a, item.id))).toBe(false);
    const db = a._openDb();
    expect(db.prepare('SELECT 1 FROM item_archive WHERE id = ?').get(item.id)).toBeUndefined();
    expect(a.get(item.id)).toBeNull();
    cleanup(a);
  });

  it('purging the last archived instance drops the type table', () => {
    const a = tmpAdapter();
    const { metadata: t } = a.createType('PurgeType', { icon: 'Category' });
    const item = a.create({ value: 'only', type: 'object', typeId: t.id, owner: OWNER, objectData: { name: 'x' } });
    const table = `obj_${t.id.replace(/-/g, '_')}`;
    a.softDelete(item.id);
    a.delete(item.id);
    const db = a._openDb();
    expect(db.prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name = ?`).get(table)).toBeUndefined();
    cleanup(a);
  });
});

describe('rebuild ingests both stores', () => {
  it('a deleted index.db reconstructs live AND archive state from the filesystem', () => {
    const a = tmpAdapter();
    const live = a.create({ value: 'alive', type: 'text', owner: OWNER });
    const dead = a.create({ value: 'archived', type: 'text', owner: OWNER });
    a.softDelete(dead.id);

    const n = a.rebuildIndexes();
    expect(n).toBeGreaterThan(0);
    const db = a._openDb();
    expect(db.prepare('SELECT 1 FROM items WHERE id = ?').get(live.id)).toBeTruthy();
    expect(db.prepare('SELECT 1 FROM items WHERE id = ?').get(dead.id)).toBeUndefined();
    expect(db.prepare('SELECT 1 FROM item_archive WHERE id = ?').get(dead.id)).toBeTruthy();
    expect(a.get(dead.id)?.deletedAt).toBeTruthy();
    cleanup(a);
  });
});

describe('migrate-on-open: legacy flag-deleted items move to archive/', () => {
  it('a pre-archive store with flagged rows upgrades on open (original stamp kept)', () => {
    const a = tmpAdapter();
    const item = a.create({ value: 'legacy-deleted', type: 'text', owner: OWNER });
    const stamp = '2025-01-01T00:00:00.000Z';

    // Simulate the pre-archive world: flag the doc in the LIVE store by hand
    // (the old softDelete behaviour) and reindex it as a live flagged row.
    const doc = JSON.parse(fs.readFileSync(path.join(liveDir(a, item.id), 'item.json'), 'utf8'));
    doc.meta.deletedAt = stamp;
    fs.writeFileSync(path.join(liveDir(a, item.id), 'item.json'), JSON.stringify(doc, null, 2));
    a.rebuildIndexes();
    // Legacy rebuild state: the flagged row sits in the LIVE tables.
    // (rebuild now routes flagged docs to archive already — force the legacy
    // shape by reinserting it as a live row, as an old index.db would have it.)
    const db = a._openDb();
    db.prepare('DELETE FROM item_archive WHERE id = ?').run(item.id);
    a._insertIndexTx(db, item.id, doc, item.id);
    db.prepare('UPDATE items_meta SET deleted_at = ? WHERE item_id = ?').run(stamp, item.id);

    const reopened = SqliteFsAdapter.open(a.root);
    expect(fs.existsSync(path.join(a.root, '.kanecta/branches/main/archive'))).toBe(true);
    const rdb = reopened._openDb();
    expect(rdb.prepare('SELECT 1 FROM items WHERE id = ?').get(item.id)).toBeUndefined();
    const meta: any = rdb.prepare('SELECT deleted_at FROM item_archive_meta WHERE item_id = ?').get(item.id);
    expect(meta?.deleted_at).toBe(stamp);
    expect(reopened.get(item.id)?.deletedAt).toBe(stamp);
    cleanup(a);
  });
});

describe('sparse branches: archive is branch-local and merges as a real move', () => {
  it('soft delete on a sparse branch masks the upstream live item; upstream untouched', () => {
    const a = tmpAdapter();
    const item = a.create({ value: 'shared', type: 'text', owner: OWNER });
    a.createBranch('feat/arch', {});             // sparse by default
    a.useBranch('feat/arch');
    a.softDelete(item.id);

    expect(a.get(item.id)?.deletedAt).toBeTruthy();
    expect(a.query({ limit: 0 }).some((i: any) => i.id === item.id)).toBe(false);
    // Upstream (main) still has it live.
    a.useBranch('main');
    expect(a.get(item.id)?.deletedAt).toBeNull();
    cleanup(a);
  });

  it('merge applies the branch soft delete as an archive move on main', () => {
    const a = tmpAdapter();
    const item = a.create({ value: 'merge-archived', type: 'text', owner: OWNER });
    a.putFile(item.id, 'keepsake.bin', Buffer.from('kept'));
    a.createBranch('feat/softdel', {});
    a.useBranch('feat/softdel');
    a.softDelete(item.id);
    a.useBranch('main');

    const preview = a.previewMerge('feat/softdel');
    const del = preview.deletes.find((d: any) => d.id === item.id);
    expect(del?.soft).toBe(true);

    a.mergeBranchLocally('feat/softdel');
    // Main's copy physically moved into main's archive/, sidecars included.
    expect(fs.existsSync(liveDir(a, item.id))).toBe(false);
    expect(fs.existsSync(path.join(archiveDir(a, item.id), 'keepsake.bin'))).toBe(true);
    expect(a.get(item.id)?.deletedAt).toBeTruthy();
    expect(a.query({ limit: 0 }).some((i: any) => i.id === item.id)).toBe(false);
    // And it is restorable on main — the move was a real soft delete.
    const restored = a.restore(item.id);
    expect(restored.deletedAt).toBeNull();
    cleanup(a);
  });

  it('hard delete (tombstone) still merges as a hard delete', () => {
    const a = tmpAdapter();
    const item = a.create({ value: 'merge-harddel', type: 'text', owner: OWNER });
    a.createBranch('feat/harddel', {});
    a.useBranch('feat/harddel');
    a.delete(item.id);
    a.useBranch('main');
    const preview = a.previewMerge('feat/harddel');
    const del = preview.deletes.find((d: any) => d.id === item.id);
    expect(del).toBeTruthy();
    expect(del.soft).toBeUndefined();
    a.mergeBranchLocally('feat/harddel');
    expect(a.get(item.id)).toBeNull();
    expect(fs.existsSync(archiveDir(a, item.id))).toBe(false);
    cleanup(a);
  });
});
