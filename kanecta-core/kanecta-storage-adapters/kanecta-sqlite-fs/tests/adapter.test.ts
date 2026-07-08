'use strict';

import os from 'os';
import path from 'path';
import fs from 'fs';

import {
  SqliteFsAdapter,
  UnknownTypeError,
  ROOT_ID,
  VALID_REL_TYPES,
} from '../src/adapter';

// ─── Setup helpers ─────────────────────────────────────────────────────────────

let tmp;
let ds;

function freshDs(owner = 'test@example.com') {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'kanecta-sqlite-'));
  ds  = SqliteFsAdapter.init(tmp, owner);
  return ds;
}

beforeEach(() => freshDs());

afterEach(() => {
  try { fs.rmSync(tmp, { recursive: true, force: true }); } catch {}
});

// ─── isDatastore / init / open ─────────────────────────────────────────────────

describe('isDatastore', () => {
  it('returns true for an initialised datastore', () => {
    expect(SqliteFsAdapter.isDatastore(tmp)).toBe(true);
  });

  it('returns false for an empty directory', () => {
    const empty = fs.mkdtempSync(path.join(os.tmpdir(), 'empty-'));
    try {
      expect(SqliteFsAdapter.isDatastore(empty)).toBe(false);
    } finally {
      fs.rmSync(empty, { recursive: true, force: true });
    }
  });

  it('returns false for a directory with no items/ subdirectory', () => {
    const fsRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'fspath-'));
    try {
      fs.mkdirSync(path.join(fsRoot, '.kanecta'), { recursive: true });
      expect(SqliteFsAdapter.isDatastore(fsRoot)).toBe(false);
    } finally {
      fs.rmSync(fsRoot, { recursive: true, force: true });
    }
  });
});

describe('init', () => {
  it('creates branches/main/items/ directory in .kanecta/', () => {
    expect(fs.existsSync(path.join(tmp, '.kanecta', 'branches', 'main', 'items'))).toBe(true);
  });

  it('creates per-branch index.db (derived SQLite index) for main', () => {
    expect(fs.existsSync(path.join(tmp, '.kanecta', 'branches', 'main', 'index.db'))).toBe(true);
  });

  it('writes branches/main/branch.json describing the canonical branch', () => {
    const manifest = JSON.parse(fs.readFileSync(path.join(tmp, '.kanecta', 'branches', 'main', 'branch.json'), 'utf8'));
    expect(manifest.name).toBe('main');
    expect(manifest.fill).toBe('full');
    expect(manifest.upstream).toBeNull();
    expect(manifest.createdAt).toBeTruthy();
  });

  it('creates .gitignore excluding index.db', () => {
    const gi = fs.readFileSync(path.join(tmp, '.kanecta', '.gitignore'), 'utf8');
    expect(gi).toContain('index.db');
  });

  it('seeds the two reserved nodes (root and types) and no obsolete roots', () => {
    const root = ds.getRoot();
    expect(root.id).toBe(ROOT_ID);
    expect(root.type).toBe('root');
    // The types node exists but is a structural boundary — not surfaced as content
    // (excluded from children/tree/loadAll), reachable directly by its fixed UUID.
    expect(ds.get('11111111-1111-1111-1111-111111111111')?.type).toBe('types');
    const kids = ds.children(ROOT_ID);
    expect(kids.some(k => k.type === 'types')).toBe(false);
    // 1.4.0 has only root + types — no system_root/app_root/component_root/data_root.
    expect(kids.some(k => ['system_root', 'app_root', 'component_root', 'data_root'].includes(k.type))).toBe(false);
  });

  it('seeds a Welcome item under root', () => {
    const kids = ds.children(ROOT_ID);
    expect(kids.some(k => k.value === 'Welcome to Kanecta!')).toBe(true);
  });

  it('stores the owner in config', () => {
    expect(ds.config.owner).toBe('test@example.com');
  });
});

describe('open', () => {
  it('reopens an existing datastore', () => {
    const ds2 = SqliteFsAdapter.open(tmp);
    expect(ds2.getRoot().id).toBe(ROOT_ID);
  });

  it('throws for a path without items/ directory', () => {
    const empty = fs.mkdtempSync(path.join(os.tmpdir(), 'empty-'));
    try {
      expect(() => SqliteFsAdapter.open(empty)).toThrow(/Not a Kanecta datastore/);
    } finally {
      fs.rmSync(empty, { recursive: true, force: true });
    }
  });

  it('does not duplicate well-known nodes on reopen', () => {
    const ds2 = SqliteFsAdapter.open(tmp);
    expect(ds2.children(ROOT_ID).length).toBe(ds.children(ROOT_ID).length);
  });
});

// ─── filesystem / file-first model ────────────────────────────────────────────

describe('filesystem: file-first model', () => {
  // Resolve an item.json path on the main branch's own items/ tree.
  const mainItemPath = (id) => {
    const hex = id.replace(/-/g, '');
    return path.join(tmp, '.kanecta', 'branches', 'main', 'items', hex.slice(0, 2), hex.slice(2, 4), id, 'item.json');
  };

  it('writes item.json to sharded items/ directory on create', () => {
    const item = ds.create({ value: 'file-first test' });
    expect(fs.existsSync(mainItemPath(item.id))).toBe(true);
  });

  it('item.json contains five sections: item, meta, search, payload, time', () => {
    const item = ds.create({ value: 'sections test' });
    const doc  = JSON.parse(fs.readFileSync(mainItemPath(item.id), 'utf8'));
    expect(doc).toHaveProperty('item');
    expect(doc).toHaveProperty('meta');
    expect(doc).toHaveProperty('search');
    expect(doc).toHaveProperty('payload');
    expect(doc).toHaveProperty('time');
  });

  it('item section contains id, parentId, type, value, sortOrder, aspect, typeId', () => {
    const item = ds.create({ value: 'item section' });
    const doc  = JSON.parse(fs.readFileSync(mainItemPath(item.id), 'utf8'));
    expect(doc.item.id).toBe(item.id);
    expect(doc.item.parentId).toBe(item.parentId);
    expect(doc.item.type).toBe('string');
    expect(doc.item.value).toBe('item section');
  });

  it('meta section contains owner, visibility, tags, createdAt', () => {
    const item = ds.create({ value: 'meta section', tags: ['a', 'b'] });
    const doc  = JSON.parse(fs.readFileSync(mainItemPath(item.id), 'utf8'));
    expect(doc.meta.owner).toBe('test@example.com');
    expect(doc.meta.visibility).toBe('private');
    expect(doc.meta.tags).toEqual(['a', 'b']);
    expect(doc.meta.createdAt).toBeTruthy();
  });

  it('payload stored in item.json via writeObjectJson', () => {
    const item = ds.create({ value: 'payload test' });
    ds.writeObjectJson(item.id, { foo: 'bar' });
    const doc = JSON.parse(fs.readFileSync(mainItemPath(item.id), 'utf8'));
    expect(doc.payload).toEqual({ foo: 'bar' });
  });

  it('readObjectJson reads from item.json', () => {
    const item = ds.create({ value: 'read payload' });
    ds.writeObjectJson(item.id, { x: 42 });
    expect(ds.readObjectJson(item.id)).toEqual({ x: 42 });
  });

  it('update writes updated item.json to disk', () => {
    const item    = ds.create({ value: 'before' });
    ds.update(item.id, { value: 'after' });
    const doc = JSON.parse(fs.readFileSync(mainItemPath(item.id), 'utf8'));
    expect(doc.item.value).toBe('after');
  });

  it('delete removes item.json from disk', () => {
    const item = ds.create({ value: 'to delete' });
    const p    = mainItemPath(item.id);
    expect(fs.existsSync(p)).toBe(true);
    ds.delete(item.id);
    expect(fs.existsSync(p)).toBe(false);
  });

  it('rebuildIndexes scans item.json files and repopulates index', () => {
    const a = ds.create({ value: 'rebuild-a' });
    const b = ds.create({ value: 'rebuild-b' });
    // Wipe the SQLite index manually
    const db = ds._openDb();
    db.prepare('DELETE FROM items_meta').run();
    db.prepare('DELETE FROM items').run();
    ds._mem.clear();
    // Rebuild
    const count = ds.rebuildIndexes();
    expect(count).toBeGreaterThan(0);
    // Both items must be findable again
    expect(ds.get(a.id)).not.toBeNull();
    expect(ds.get(b.id)).not.toBeNull();
  });

  it('open() rebuilds index from filesystem when index.db is empty', () => {
    const item = ds.create({ value: 'persist check' });
    // Delete the main branch's index.db to force rebuild on next open
    const dbPath = path.join(tmp, '.kanecta', 'branches', 'main', 'index.db');
    ds._db.close();
    ds._db = null;
    fs.unlinkSync(dbPath);
    const ds2 = SqliteFsAdapter.open(tmp);
    expect(ds2.get(item.id)).not.toBeNull();
    expect(ds2.get(item.id).value).toBe('persist check');
  });

  it('config is read from root item.json payload', () => {
    expect(ds.config.owner).toBe('test@example.com');
    expect(ds.config.specVersion).toBe('1.4.0');
  });
});

// ─── source of truth lives on the filesystem (index.db is 100% derived) ─────────

describe('index.db is 100% derived from the filesystem', () => {
  it('history, aliases, relationships and annotations all survive deleting index.db', () => {
    const a = ds.create({ value: 'alpha' });
    const b = ds.create({ value: 'beta' });
    ds.update(a.id, { value: 'alpha-2' });                  // → item_history event
    ds.setAlias('the-alpha', a.id);                          // → alias item
    ds.relate(a.id, 'depends-on', b.id, { note: 'critical' }); // → relationship item
    ds.annotate(a.id, { content: 'a note', author: 'x@y.z' }); // → annotation item

    // Nuke the entire derived index — the filesystem must still hold everything.
    const dbPath = path.join(tmp, '.kanecta', 'branches', 'main', 'index.db');
    ds._db.close();
    ds._db = null;
    fs.unlinkSync(dbPath);

    const ds2 = SqliteFsAdapter.open(tmp); // rebuilds index.db by scanning the FS

    expect(ds2.history(a.id).length).toBeGreaterThan(0);
    expect(ds2.history(a.id).some(e => e.changeType === 'update')).toBe(true);
    expect(ds2.resolveAlias('the-alpha')).toBe(a.id);
    expect(ds2.relationships(a.id).outbound).toHaveLength(1);
    expect(ds2.relationships(a.id).outbound[0].targetId).toBe(b.id);
    expect(ds2.relationships(b.id).inbound).toHaveLength(1);
    expect(ds2.annotations(a.id)).toHaveLength(1);
    expect(ds2.annotations(a.id)[0].content).toBe('a note');
  });

  it('itemHistory EXTERNAL (default) writes events to item-history/, not items/', () => {
    const a = ds.create({ value: 'x' });
    ds.update(a.id, { value: 'y' });
    const histDir = path.join(tmp, '.kanecta', 'branches', 'main', 'item-history');
    expect(fs.existsSync(histDir)).toBe(true);
    expect(ds.history(a.id).length).toBeGreaterThan(0);
  });

  it('itemHistory ITEM mode places events in items/ and still rebuilds', () => {
    ds._config.itemHistory = 'ITEM';
    ds._saveConfig();
    const a = ds.create({ value: 'x' });
    ds.update(a.id, { value: 'y' });
    expect(ds.history(a.id).length).toBeGreaterThan(0);
    // History items live in items/, but are excluded from content traversal.
    expect(ds.loadAll().some(i => i.type === 'item_history')).toBe(false);
    // Survives an index rebuild from items/.
    ds.rebuildIndexes();
    expect(ds.history(a.id).length).toBeGreaterThan(0);
  });

  it('rebuildIndexes() reprojects metadata tables from item.json files', () => {
    const a = ds.create({ value: 'x' });
    ds.setAlias('xx', a.id);
    ds.annotate(a.id, { content: 'note' });
    ds.rebuildIndexes();
    expect(ds.resolveAlias('xx')).toBe(a.id);
    expect(ds.annotations(a.id)).toHaveLength(1);
  });

  it('the metadata derived tables are never the only home for the data', () => {
    // Sanity: an alias/relationship/annotation must exist as an item.json on disk.
    const a = ds.create({ value: 'x' });
    const b = ds.create({ value: 'y' });
    ds.setAlias('zz', a.id);
    ds.relate(a.id, 'relates-to', b.id);
    ds.annotate(a.id, { content: 'c' });
    const itemsDir = path.join(tmp, '.kanecta', 'branches', 'main', 'items');
    const histDir  = path.join(tmp, '.kanecta', 'branches', 'main', 'item-history');
    const countJson = (dir) => {
      let n = 0;
      const walk = (d) => {
        if (!fs.existsSync(d)) return;
        for (const e of fs.readdirSync(d)) {
          const full = path.join(d, e);
          if (fs.statSync(full).isDirectory()) walk(full);
          else if (e === 'item.json') n++;
        }
      };
      walk(dir);
      return n;
    };
    // alias + relationship + annotation + the two content items + roots all on disk.
    expect(countJson(itemsDir)).toBeGreaterThanOrEqual(5);
    expect(countJson(histDir)).toBeGreaterThan(0); // history events written to disk
  });
});

// ─── write integrity: crash recovery (journal + lock) ───────────────────────────

describe('write integrity — crash recovery', () => {
  const branchRoot = () => path.join(tmp, '.kanecta', 'branches', 'main');
  const journalPath = () => path.join(branchRoot(), 'write.journal');
  const lockPath    = () => path.join(branchRoot(), 'write.lock');
  const itemPath    = (id) => {
    const hex = id.replace(/-/g, '');
    return path.join(branchRoot(), 'items', hex.slice(0, 2), hex.slice(2, 4), id, 'item.json');
  };
  const reopen = () => { ds._db?.close(); ds._db = null; return SqliteFsAdapter.open(tmp); };

  it('rolls back a half-applied write (phase "started") to the pre-image on reopen', () => {
    const a = ds.create({ value: 'original' });
    const preImage = JSON.parse(fs.readFileSync(itemPath(a.id), 'utf8'));

    // Simulate a crash mid-update: the file already holds the new value, but the
    // journal is still 'started' (never reached l0-done) — so the write is not
    // durable and must be undone.
    const corrupt = JSON.parse(JSON.stringify(preImage));
    corrupt.item.value = 'half-written';
    fs.writeFileSync(itemPath(a.id), JSON.stringify(corrupt));
    fs.writeFileSync(journalPath(), JSON.stringify({
      phase: 'started', branch: 'main',
      ops: [{ id: a.id, store: 'items', preImage }],
    }));

    const ds2 = reopen();
    expect(ds2.get(a.id).value).toBe('original');     // rolled back
    expect(fs.existsSync(journalPath())).toBe(false); // journal cleared
  });

  it('rolls back a half-applied create (pre-image null → item removed) on reopen', () => {
    const ghostId = '9a9a9a9a-9a9a-4a9a-8a9a-9a9a9a9a9a9a';
    const doc = {
      item: { id: ghostId, parentId: ROOT_ID, type: 'text', typeId: null, value: 'ghost', sortOrder: 0, aspect: null },
      meta: { specVersion: '1.4.0', owner: 'x', createdAt: 't', modifiedAt: 't', tags: [], visibility: 'private' },
      search: null, payload: null, time: null,
    };
    fs.mkdirSync(path.dirname(itemPath(ghostId)), { recursive: true });
    fs.writeFileSync(itemPath(ghostId), JSON.stringify(doc));
    fs.writeFileSync(journalPath(), JSON.stringify({
      phase: 'started', branch: 'main',
      ops: [{ id: ghostId, store: 'items', preImage: null }],
    }));

    const ds2 = reopen();
    expect(ds2.get(ghostId)).toBeNull();              // creation undone
    expect(fs.existsSync(itemPath(ghostId))).toBe(false);
  });

  it('rolls forward a completed write (phase "l0-done") by rebuilding the index', () => {
    const a = ds.create({ value: 'original' });
    // Authoritative file holds the new value; the journal reached l0-done but the
    // crash happened before commit — so the index may be stale. Roll forward.
    const doc = JSON.parse(fs.readFileSync(itemPath(a.id), 'utf8'));
    doc.item.value = 'durable-new';
    fs.writeFileSync(itemPath(a.id), JSON.stringify(doc));
    fs.writeFileSync(journalPath(), JSON.stringify({
      phase: 'l0-done', branch: 'main',
      ops: [{ id: a.id, store: 'items', preImage: null }],
    }));

    const ds2 = reopen();
    expect(ds2.get(a.id).value).toBe('durable-new');  // kept + reindexed
    expect(fs.existsSync(journalPath())).toBe(false);
  });

  it('clears a stale lock left by a dead process on open', () => {
    fs.writeFileSync(lockPath(), JSON.stringify({ pid: 2 ** 30, host: os.hostname(), heartbeatAt: Date.now() }));
    const ds2 = reopen();
    expect(fs.existsSync(lockPath())).toBe(false);
    expect(() => ds2.create({ value: 'after-recovery' })).not.toThrow();
  });

  it('normal writes leave no journal or lock behind', () => {
    ds.create({ value: 'clean' });
    expect(fs.existsSync(journalPath())).toBe(false);
    expect(fs.existsSync(lockPath())).toBe(false);
  });

  it('reads never block on an in-flight write — they return the last committed value', () => {
    const a = ds.create({ value: 'committed' });
    // Simulate another process holding the write lock with an in-flight journal.
    fs.writeFileSync(lockPath(), JSON.stringify({ pid: process.pid, host: os.hostname(), heartbeatAt: Date.now() }));
    fs.writeFileSync(journalPath(), JSON.stringify({ phase: 'started', branch: 'main', ops: [{ id: a.id, store: 'items', preImage: null }] }));
    // Reads do not acquire the lock, so this returns immediately with the
    // last-committed value rather than waiting for the writer.
    expect(ds.get(a.id).value).toBe('committed');
    expect(ds.children(ROOT_ID).some(c => c.id === a.id)).toBe(true);
    fs.rmSync(lockPath(), { force: true });
    fs.rmSync(journalPath(), { force: true });
  });
});

// ─── create ────────────────────────────────────────────────────────────────────

describe('create', () => {
  it('creates an item under root by default', () => {
    const item = ds.create({ value: 'hello' });
    expect(item.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(item.parentId).toBe(ds.getRoot().id);
    expect(item.value).toBe('hello');
  });

  it('creates item under explicit parentId', () => {
    const parent = ds.create({ value: 'parent' });
    const child  = ds.create({ value: 'child', parentId: parent.id });
    expect(child.parentId).toBe(parent.id);
  });

  it('assigns sortOrder based on sibling count', () => {
    const a = ds.create({ value: 'a' });
    const b = ds.create({ value: 'b' });
    expect(b.sortOrder).toBeGreaterThan(a.sortOrder);
  });

  it('respects explicit sortOrder', () => {
    const item = ds.create({ value: 'x', sortOrder: 42 });
    expect(item.sortOrder).toBe(42);
  });

  it('persists tags', () => {
    const item = ds.create({ value: 'x', tags: ['alpha', 'beta'] });
    expect(item.tags).toEqual(['alpha', 'beta']);
    expect(ds.get(item.id).tags).toEqual(['alpha', 'beta']);
  });

  it('indexes tags for byTag lookup immediately after create', () => {
    const item = ds.create({ value: 'x', tags: ['featured'] });
    expect(ds.byTag('featured')).toContain(item.id);
  });

  it('creates item with objectData for typed object', () => {
    const { metadata: typeMeta } = ds.createType('Bug', { icon: 'Category' });
    const item = ds.create({ value: 'bug', type: 'object', typeId: typeMeta.id, objectData: { severity: 'P1' } });
    expect(ds.readObjectJson(item.id)).toEqual({ severity: 'P1' });
  });

  it('throws for well-known type names', () => {
    expect(() => ds.create({ type: 'root' })).toThrow(/well-known root type/);
    expect(() => ds.create({ type: 'types' })).toThrow(/well-known root type/);
  });

  it('writes backlinks for [[uuid]] references in value', () => {
    const target = ds.create({ value: 'target' });
    const linker = ds.create({ value: `see [[${target.id}]]` });
    expect(ds.backlinks(target.id)).toContain(linker.id);
  });

  it('records a create event in history', () => {
    const item = ds.create({ value: 'x' });
    const h    = ds.history(item.id);
    expect(h.some(e => e.changeType === 'create')).toBe(true);
  });

  it('warns (not throws) for unknown typeId in default mode', () => {
    const fake = 'ffffffff-ffff-4fff-bfff-ffffffffffff';
    const item = ds.create({ value: 'x', type: 'object', typeId: fake });
    // item exists (warn mode), and has a non-enumerable warning
    expect(item.id).toBeDefined();
    expect(Object.getOwnPropertyDescriptor(item, 'warning')?.value).toMatch(/has no type definition/);
  });

  it('throws for unknown typeId in strict mode', () => {
    const fake = 'ffffffff-ffff-4fff-bfff-ffffffffffff';
    expect(() => ds.create({ value: 'x', type: 'object', typeId: fake, strict: true }))
      .toThrow(/UNKNOWN_TYPE|no registered type definition/);
  });
});

// ─── get ───────────────────────────────────────────────────────────────────────

describe('get', () => {
  it('retrieves a created item', () => {
    const item = ds.create({ value: 'hello' });
    expect(ds.get(item.id)?.value).toBe('hello');
  });

  it('returns null for unknown UUID', () => {
    expect(ds.get('ffffffff-ffff-4fff-bfff-ffffffffffff')).toBeNull();
  });

  it('gets ROOT_ID', () => {
    expect(ds.get(ROOT_ID)?.type).toBe('root');
  });

  it('handles synthetic IDs for objectData fields', () => {
    const { metadata: t } = ds.createType('Widget', { icon: 'Category' });
    const item = ds.create({ value: 'w', type: 'object', typeId: t.id, objectData: { colour: 'red' } });
    const synId = `${item.id}__colour`;
    const syn   = ds.get(synId);
    expect(syn).not.toBeNull();
    expect(syn._synthetic).toBe(true);
  });

  it('returns icon from type schema when present', () => {
    const { metadata: t } = ds.createType('Flagged', {
      schema: {
        meta: { icon: '🚩', description: '', details: '', keywords: '', tags: '', 'ai-instructions': { claude: '' } },
        jsonSchema: { '$schema': 'http://json-schema.org/draft-07/schema#', '$id': '', title: 'Flagged', type: 'object', properties: {}, required: [], additionalProperties: false },
      },
    });
    const item = ds.create({ value: 'x', type: 'object', typeId: t.id });
    expect(ds.get(item.id).icon).toBe('🚩');
  });
});

// ─── update ────────────────────────────────────────────────────────────────────

describe('update', () => {
  it('updates value', () => {
    const item = ds.create({ value: 'old' });
    ds.update(item.id, { value: 'new' });
    expect(ds.get(item.id).value).toBe('new');
  });

  it('updates tags — adds and removes from index', () => {
    const item = ds.create({ value: 'x', tags: ['a'] });
    ds.update(item.id, { tags: ['b'] });
    expect(ds.byTag('a')).not.toContain(item.id);
    expect(ds.byTag('b')).toContain(item.id);
  });

  it('updates confidence, status, sortOrder, visibility', () => {
    const item    = ds.create({ value: 'x' });
    const updated = ds.update(item.id, { confidence: 'locked', status: 'done', sortOrder: 99 });
    expect(updated.confidence).toBe('locked');
    expect(updated.status).toBe('done');
    expect(updated.sortOrder).toBe(99);
  });

  it('updates 1.4.0 meta fields (expiresAt, connectorId, materialized, cachedAt)', () => {
    const item = ds.create({ value: 'x' });
    const now  = new Date().toISOString();
    ds.update(item.id, {
      expiresAt:   now,
      connectorId: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
      materialized: false,
      cachedAt:    now,
    });
    const got = ds.get(item.id);
    expect(got.expiresAt).toBe(now);
    expect(got.connectorId).toBe('aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee');
    expect(got.materialized).toBe(false);
    expect(got.cachedAt).toBe(now);
  });

  it('clears expiresAt by setting to null', () => {
    const item = ds.create({ value: 'x' });
    ds.update(item.id, { expiresAt: new Date().toISOString() });
    ds.update(item.id, { expiresAt: null });
    expect(ds.get(item.id).expiresAt).toBeNull();
  });

  it('updates backlinks when value changes', () => {
    const target = ds.create({ value: 'target' });
    const linker = ds.create({ value: 'no link' });
    ds.update(linker.id, { value: `[[${target.id}]]` });
    expect(ds.backlinks(target.id)).toContain(linker.id);
    ds.update(linker.id, { value: 'removed link' });
    expect(ds.backlinks(target.id)).not.toContain(linker.id);
  });

  it('updates modifiedAt on each call', async () => {
    const item = ds.create({ value: 'x' });
    const t1   = item.modifiedAt;
    await new Promise(r => setTimeout(r, 5));
    const r2   = ds.update(item.id, { value: 'y' });
    expect(r2.modifiedAt > t1).toBe(true);
  });

  it('records update event in history', () => {
    const item = ds.create({ value: 'x' });
    ds.update(item.id, { value: 'y' });
    const h = ds.history(item.id);
    expect(h.some(e => e.changeType === 'update')).toBe(true);
  });

  it('throws when editing a reserved node (types)', () => {
    const types = ds.get('11111111-1111-1111-1111-111111111111');
    expect(() => ds.update(types.id, { value: 'x' })).toThrow(/reserved root node/);
  });

  it('allows renaming the root node value', () => {
    const updated = ds.update(ROOT_ID, { value: 'My Knowledge Base' });
    expect(updated.value).toBe('My Knowledge Base');
    expect(ds.getRoot().value).toBe('My Knowledge Base');
    // still the structural anchor
    expect(ds.getRoot().type).toBe('root');
    expect(ds.getRoot().id).toBe(ROOT_ID);
  });

  it('locks the root node structural fields', () => {
    expect(() => ds.update(ROOT_ID, { type: 'text' })).toThrow(/root node's 'type'/);
    expect(() => ds.update(ROOT_ID, { parentId: ds.create({ value: 'p' }).id })).toThrow(/root node's 'parentId'/);
    expect(() => ds.update(ROOT_ID, { typeId: '22222222-2222-2222-2222-222222222222' })).toThrow(/root node's 'typeId'/);
    expect(() => ds.update(ROOT_ID, { sortOrder: 5 })).toThrow(/root node's 'sortOrder'/);
  });

  it('root remains non-deletable after becoming renamable', () => {
    expect(() => ds.softDelete(ROOT_ID)).toThrow(/reserved root node/);
    expect(() => ds.delete(ROOT_ID)).toThrow(/reserved root node/);
  });

  // ── parentId change cascades materialized path ─────────────────────────────

  it('cascades path update when parentId changes', () => {
    const parent1 = ds.create({ value: 'p1' });
    const parent2 = ds.create({ value: 'p2' });
    const child   = ds.create({ value: 'c', parentId: parent1.id });
    const grand   = ds.create({ value: 'g', parentId: child.id });

    // Move child to parent2
    ds.update(child.id, { parentId: parent2.id });

    const p2Path    = ds._getPath(parent2.id);
    const childPath = ds._getPath(child.id);
    const grandPath = ds._getPath(grand.id);

    expect(childPath).toBe(`${p2Path}/${child.id}`);
    // grandchild path should also have been cascaded
    expect(grandPath).toBe(`${childPath}/${grand.id}`);
  });

  it('tree() reflects moved subtree after parentId change', () => {
    const p1    = ds.create({ value: 'p1' });
    const p2    = ds.create({ value: 'p2' });
    const child = ds.create({ value: 'c', parentId: p1.id });
    ds.update(child.id, { parentId: p2.id });
    const t2 = ds.tree(p2.id);
    expect(t2.some(n => n.item.id === child.id)).toBe(true);
    const t1 = ds.tree(p1.id);
    expect(t1.some(n => n.item.id === child.id)).toBe(false);
  });
});

// ─── delete ────────────────────────────────────────────────────────────────────

describe('delete', () => {
  it('removes an item', () => {
    const item = ds.create({ value: 'bye' });
    ds.delete(item.id);
    expect(ds.get(item.id)).toBeNull();
  });

  it('returns warnings for items with backlinks', () => {
    const target = ds.create({ value: 'target' });
    ds.create({ value: `[[${target.id}]]` });
    const result = ds.deleteWarnings(target.id);
    expect(result.length).toBeGreaterThan(0);
  });

  it('removes tag index entries on delete', () => {
    const item = ds.create({ value: 'x', tags: ['old'] });
    ds.delete(item.id);
    expect(ds.byTag('old')).not.toContain(item.id);
  });

  it('removes backlink entries on delete', () => {
    const target = ds.create({ value: 'target' });
    const linker = ds.create({ value: `[[${target.id}]]` });
    ds.delete(linker.id);
    expect(ds.backlinks(target.id)).not.toContain(linker.id);
  });

  it('cleans up inbound and outbound backlinks', () => {
    const target = ds.create({ value: 'target' });
    const linker = ds.create({ value: `see [[${target.id}]]` });
    ds.delete(target.id);
    // No error on subsequent operations
    expect(ds.get(target.id)).toBeNull();
  });

  it('throws for well-known nodes', () => {
    expect(() => ds.delete(ROOT_ID)).toThrow(/reserved root node/);
    const dr = ds.getRoot();
    expect(() => ds.delete(dr.id)).toThrow(/reserved root node/);
  });

  it('records delete event in history', () => {
    const item = ds.create({ value: 'x' });
    ds.delete(item.id);
    const h = ds.history(item.id);
    expect(h.some(e => e.changeType === 'delete')).toBe(true);
  });

  it('is a no-op for synthetic IDs', () => {
    expect(ds.delete('some-id__field')).toEqual({ warnings: [] });
  });
});

// ─── softDelete / restore ──────────────────────────────────────────────────────

describe('softDelete / restore', () => {
  it('softDelete sets deletedAt', () => {
    const item = ds.create({ value: 'x' });
    const res  = ds.softDelete(item.id);
    expect(res.deletedAt).not.toBeNull();
    expect(ds.get(item.id).deletedAt).not.toBeNull();
  });

  it('softDeleted item is excluded from query() by default', () => {
    const item = ds.create({ value: 'x' });
    ds.softDelete(item.id);
    const results = ds.query({ type: 'string' });
    expect(results.some(i => i.id === item.id)).toBe(false);
  });

  it('softDeleted item included when includeDeleted: true', () => {
    const item = ds.create({ value: 'x' });
    ds.softDelete(item.id);
    const results = ds.query({ type: 'string', includeDeleted: true });
    expect(results.some(i => i.id === item.id)).toBe(true);
  });

  it('item is still get()-able after softDelete', () => {
    const item = ds.create({ value: 'x' });
    ds.softDelete(item.id);
    expect(ds.get(item.id)).not.toBeNull();
  });

  it('restore clears deletedAt', () => {
    const item = ds.create({ value: 'x' });
    ds.softDelete(item.id);
    const res = ds.restore(item.id);
    expect(res.deletedAt).toBeNull();
    expect(ds.get(item.id).deletedAt).toBeNull();
  });

  it('restored item appears in default query() again', () => {
    const item = ds.create({ value: 'x' });
    ds.softDelete(item.id);
    ds.restore(item.id);
    const results = ds.query({ type: 'string' });
    expect(results.some(i => i.id === item.id)).toBe(true);
  });

  it('records soft-delete event in history', () => {
    const item = ds.create({ value: 'x' });
    ds.softDelete(item.id);
    expect(ds.history(item.id).some(e => e.changeType === 'soft-delete')).toBe(true);
  });

  it('records restore event in history', () => {
    const item = ds.create({ value: 'x' });
    ds.softDelete(item.id);
    ds.restore(item.id);
    expect(ds.history(item.id).some(e => e.changeType === 'restore')).toBe(true);
  });

  it('soft-delete cycle: soft-delete → restore → soft-delete', () => {
    const item = ds.create({ value: 'x' });
    ds.softDelete(item.id);
    ds.restore(item.id);
    ds.softDelete(item.id);
    expect(ds.get(item.id).deletedAt).not.toBeNull();
  });

  it('throws restore on unknown item', () => {
    expect(() => ds.restore('ffffffff-ffff-4fff-bfff-ffffffffffff')).toThrow(/Item not found/);
  });
});

// ─── children ──────────────────────────────────────────────────────────────────

describe('children', () => {
  it('returns direct children sorted by sortOrder', () => {
    const parent = ds.create({ value: 'p' });
    ds.create({ value: 'c2', parentId: parent.id, sortOrder: 10 });
    ds.create({ value: 'c1', parentId: parent.id, sortOrder: 0 });
    const kids = ds.children(parent.id);
    expect(kids[0].value).toBe('c1');
    expect(kids[1].value).toBe('c2');
  });

  it('returns empty array for a leaf item', () => {
    const item = ds.create({ value: 'leaf' });
    expect(ds.children(item.id)).toEqual([]);
  });

  it('filters by aspect when provided', () => {
    const parent = ds.create({ value: 'p' });
    ds.create({ value: 'sidebar', parentId: parent.id, aspect: 'sidebar' });
    ds.create({ value: 'main',    parentId: parent.id });
    const sidebarKids = ds.children(parent.id, 'sidebar');
    expect(sidebarKids.length).toBe(1);
    expect(sidebarKids[0].value).toBe('sidebar');
    const mainKids = ds.children(parent.id, null);
    expect(mainKids.length).toBe(1);
    expect(mainKids[0].value).toBe('main');
  });

  it('returns synthetic children for a typed object', () => {
    const { metadata: t } = ds.createType('Card', { icon: 'Category' });
    const item = ds.create({ value: 'c', type: 'object', typeId: t.id, objectData: { title: 'Hello' } });
    const kids = ds.children(item.id);
    expect(kids.some(k => k._synthetic && k._fieldPath === 'title')).toBe(true);
  });

  it('navigates into synthetic parent', () => {
    const { metadata: t } = ds.createType('Nested', { icon: 'Category' });
    const item = ds.create({ value: 'n', type: 'object', typeId: t.id, objectData: { meta: { author: 'Alice' } } });
    const synId = `${item.id}__meta`;
    const kids  = ds.children(synId);
    expect(kids.some(k => k._fieldPath === 'meta.author')).toBe(true);
  });

  it('returns empty array for synthetic leaf', () => {
    const { metadata: t } = ds.createType('T', { icon: 'Category' });
    const item = ds.create({ value: 'x', type: 'object', typeId: t.id, objectData: { val: 'scalar' } });
    expect(ds.children(`${item.id}__val.__`)).toEqual([]);
  });
});

// ─── tree ──────────────────────────────────────────────────────────────────────

describe('tree', () => {
  it('returns root item at depth 0, children at depth 1', () => {
    const root  = ds.create({ value: 'root' });
    const child = ds.create({ value: 'child', parentId: root.id });
    const t     = ds.tree(root.id);
    expect(t[0]).toEqual({ item: expect.objectContaining({ id: root.id }), depth: 0 });
    expect(t[1]).toEqual({ item: expect.objectContaining({ id: child.id }), depth: 1 });
  });

  it('respects maxDepth — excludes deeper nodes', () => {
    const root   = ds.create({ value: 'root' });
    const child  = ds.create({ value: 'child', parentId: root.id });
    const grand  = ds.create({ value: 'grand', parentId: child.id });
    const t      = ds.tree(root.id, 1);
    expect(t.some(n => n.item.id === grand.id)).toBe(false);
    expect(t.some(n => n.item.id === child.id)).toBe(true);
  });

  it('returns [] for missing rootId', () => {
    expect(ds.tree('ffffffff-ffff-4fff-bfff-ffffffffffff')).toEqual([]);
  });

  it('uses implicit root when no rootId given', () => {
    const item = ds.create({ value: 'x' });
    const t = ds.tree(null);
    const ids = t.map(n => n.item.id);
    expect(ids).toContain(item.id);
  });

  it('children within same level are sorted by sortOrder', () => {
    const parent = ds.create({ value: 'p' });
    ds.create({ value: 'z', parentId: parent.id, sortOrder: 10 });
    ds.create({ value: 'a', parentId: parent.id, sortOrder: 0 });
    const t     = ds.tree(parent.id);
    const vals  = t.filter(n => n.depth === 1).map(n => n.item.value);
    expect(vals).toEqual(['a', 'z']);
  });

  it('only loads subtree rows from SQL (path index used)', () => {
    // Create 100 items at root, then a separate subtree to query
    const parent = ds.create({ value: 'subtree-root' });
    for (let i = 0; i < 50; i++) ds.create({ value: `noise-${i}` });
    const child = ds.create({ value: 'child', parentId: parent.id });

    const t = ds.tree(parent.id);
    // Only parent + child should appear — not the 50 noise items
    expect(t).toHaveLength(2);
    expect(t[0].item.id).toBe(parent.id);
    expect(t[1].item.id).toBe(child.id);
  });
});

// ─── materialized path ─────────────────────────────────────────────────────────

describe('materialized path', () => {
  it('root node has path = ROOT_ID', () => {
    expect(ds._getPath(ROOT_ID)).toBe(ROOT_ID);
  });

  it('child of root has path = ROOT_ID/childId', () => {
    const child = ds.create({ value: 'c' });   // parentId defaults to root
    expect(ds._getPath(child.id)).toBe(`${ROOT_ID}/${child.id}`);
  });

  it('grandchild path encodes full ancestry', () => {
    const parent = ds.create({ value: 'p' });   // under root
    const child  = ds.create({ value: 'c', parentId: parent.id });
    expect(ds._getPath(child.id)).toBe(`${ROOT_ID}/${parent.id}/${child.id}`);
  });

  it('cascades path on parentId change, including deep descendants', () => {
    const p1 = ds.create({ value: 'p1' });
    const p2 = ds.create({ value: 'p2' });
    const c  = ds.create({ value: 'c',  parentId: p1.id });
    const gc = ds.create({ value: 'gc', parentId: c.id });
    const ggc = ds.create({ value: 'ggc', parentId: gc.id });

    ds.update(c.id, { parentId: p2.id });

    const p2Path  = ds._getPath(p2.id);
    const cPath   = ds._getPath(c.id);
    const gcPath  = ds._getPath(gc.id);
    const ggcPath = ds._getPath(ggc.id);

    expect(cPath).toBe(`${p2Path}/${c.id}`);
    expect(gcPath).toBe(`${cPath}/${gc.id}`);
    expect(ggcPath).toBe(`${gcPath}/${ggc.id}`);
  });

  it('_pathDepth counts slashes correctly', () => {
    expect(ds._pathDepth(ROOT_ID)).toBe(0);
    expect(ds._pathDepth(`${ROOT_ID}/abc`)).toBe(1);
    expect(ds._pathDepth(`${ROOT_ID}/abc/def`)).toBe(2);
  });
});

// ─── ancestors ─────────────────────────────────────────────────────────────────

describe('ancestors', () => {
  it('returns empty array for the root node', () => {
    expect(ds.ancestors(ROOT_ID)).toEqual([]);
  });

  it('returns [root] for a direct child of root', () => {
    const child = ds.create({ value: 'c' });   // under root
    const anc   = ds.ancestors(child.id);
    expect(anc.map(a => a.id)).toEqual([ROOT_ID]);
  });

  it('returns full ancestor chain root → parent', () => {
    const p   = ds.create({ value: 'parent' });
    const c   = ds.create({ value: 'child', parentId: p.id });
    const anc = ds.ancestors(c.id);
    const ids = anc.map(a => a.id);
    expect(ids).toContain(ROOT_ID);
    expect(ids).toContain(ds.getRoot().id);
    expect(ids).toContain(p.id);
    expect(ids).not.toContain(c.id);
  });

  it('preserves root-to-parent ordering', () => {
    const p   = ds.create({ value: 'p' });
    const c   = ds.create({ value: 'c', parentId: p.id });
    const anc = ds.ancestors(c.id);
    // ROOT_ID should come first
    expect(anc[0].id).toBe(ROOT_ID);
    // parent should be last
    expect(anc[anc.length - 1].id).toBe(p.id);
  });
});

// ─── subtreeCount ──────────────────────────────────────────────────────────────

describe('subtreeCount', () => {
  it('returns 1 for an item with no children', () => {
    const item = ds.create({ value: 'leaf' });
    expect(ds.subtreeCount(item.id)).toBe(1);
  });

  it('counts all descendants', () => {
    const parent = ds.create({ value: 'p' });
    ds.create({ value: 'c1', parentId: parent.id });
    const c2 = ds.create({ value: 'c2', parentId: parent.id });
    ds.create({ value: 'gc', parentId: c2.id });
    expect(ds.subtreeCount(parent.id)).toBe(4); // parent + 2 children + 1 grandchild
  });

  it('returns 0 for unknown item', () => {
    expect(ds.subtreeCount('ffffffff-ffff-4fff-bfff-ffffffffffff')).toBe(0);
  });
});

// ─── aliases ───────────────────────────────────────────────────────────────────

describe('aliases', () => {
  it('sets and resolves an alias', () => {
    const item = ds.create({ value: 'x' });
    ds.setAlias('my-alias', item.id);
    expect(ds.resolveAlias('my-alias')).toBe(item.id);
  });

  it('returns null for unknown alias', () => {
    expect(ds.resolveAlias('nope')).toBeNull();
  });

  it('listAliases returns all aliases sorted', () => {
    const a = ds.create({ value: 'a' });
    const b = ds.create({ value: 'b' });
    ds.setAlias('zzz', a.id);
    ds.setAlias('aaa', b.id);
    const list = ds.listAliases();
    expect(list[0].alias).toBe('aaa');
    expect(list[1].alias).toBe('zzz');
    expect(list[0].targetId).toBe(b.id);
  });

  it('removeAlias deletes it', () => {
    const item = ds.create({ value: 'x' });
    ds.setAlias('bye', item.id);
    ds.removeAlias('bye');
    expect(ds.resolveAlias('bye')).toBeNull();
  });

  it('overwriting an alias updates the target', () => {
    const a = ds.create({ value: 'a' });
    const b = ds.create({ value: 'b' });
    ds.setAlias('alias', a.id);
    ds.setAlias('alias', b.id);
    expect(ds.resolveAlias('alias')).toBe(b.id);
  });

  it('resolve() looks up by UUID or alias', () => {
    const item = ds.create({ value: 'x' });
    ds.setAlias('x-alias', item.id);
    expect(ds.resolve(item.id)?.id).toBe(item.id);
    expect(ds.resolve('x-alias')?.id).toBe(item.id);
    expect(ds.resolve('nope')).toBeNull();
  });
});

// ─── annotations ───────────────────────────────────────────────────────────────

describe('annotations', () => {
  it('annotates an item and retrieves it', () => {
    const item = ds.create({ value: 'x' });
    const ann  = ds.annotate(item.id, { content: 'my note' });
    expect(ann.id).toBeDefined();
    expect(ann.content).toBe('my note');
    expect(ann.targetId).toBe(item.id);
    const all = ds.annotations(item.id);
    expect(all).toHaveLength(1);
    expect(all[0].content).toBe('my note');
  });

  it('returns empty array when no annotations', () => {
    const item = ds.create({ value: 'x' });
    expect(ds.annotations(item.id)).toEqual([]);
  });

  it('multiple annotations are returned sorted by createdAt', async () => {
    const item = ds.create({ value: 'x' });
    ds.annotate(item.id, { content: 'first' });
    await new Promise(r => setTimeout(r, 5));
    ds.annotate(item.id, { content: 'second' });
    const all = ds.annotations(item.id);
    expect(all[0].content).toBe('first');
    expect(all[1].content).toBe('second');
  });

  it('stores author and parentAnnotationId', () => {
    const item  = ds.create({ value: 'x' });
    const root  = ds.annotate(item.id, { content: 'root', author: 'alice@example.com' });
    const reply = ds.annotate(item.id, { content: 'reply', parentAnnotationId: root.id });
    const all   = ds.annotations(item.id);
    const rootAnn  = all.find(a => a.id === root.id);
    const replyAnn = all.find(a => a.id === reply.id);
    expect(rootAnn.author).toBe('alice@example.com');
    expect(replyAnn.parentAnnotationId).toBe(root.id);
  });
});

// ─── relationships ─────────────────────────────────────────────────────────────

describe('relationships', () => {
  it('relate() creates outbound + inbound entries', () => {
    const a = ds.create({ value: 'a' });
    const b = ds.create({ value: 'b' });
    const r = ds.relate(a.id, 'depends-on', b.id, { note: 'critical' });
    expect(r.type).toBe('depends-on');
    expect(r.note).toBe('critical');
    const ra = ds.relationships(a.id);
    expect(ra.outbound).toHaveLength(1);
    expect(ra.outbound[0].targetId).toBe(b.id);
    const rb = ds.relationships(b.id);
    expect(rb.inbound).toHaveLength(1);
    expect(rb.inbound[0].sourceId).toBe(a.id);
  });

  it('throws for invalid relationship type', () => {
    const a = ds.create({ value: 'a' });
    const b = ds.create({ value: 'b' });
    expect(() => ds.relate(a.id, 'invented-type', b.id)).toThrow(/Invalid relationship type/);
  });

  it('relationships() returns empty outbound/inbound for item with no relationships', () => {
    const item = ds.create({ value: 'x' });
    const r = ds.relationships(item.id);
    expect(r.outbound).toEqual([]);
    expect(r.inbound).toEqual([]);
  });

  it('backlinks() returns IDs of items linking via [[uuid]] syntax', () => {
    const target = ds.create({ value: 'target' });
    const linker = ds.create({ value: `see [[${target.id}]]` });
    expect(ds.backlinks(target.id)).toContain(linker.id);
  });

  it('listRelationships() returns all relationships', () => {
    const a = ds.create({ value: 'a' });
    const b = ds.create({ value: 'b' });
    const c = ds.create({ value: 'c' });
    ds.relate(a.id, 'depends-on', b.id);
    ds.relate(b.id, 'relates-to', c.id);
    expect(ds.listRelationships()).toHaveLength(2);
  });

  it('addRelTypes() adds custom relationship types', () => {
    ds.addRelTypes(['affects', 'evidenced-by']);
    expect(ds.relTypes).toContain('affects');
    expect(ds.relTypes).toContain('evidenced-by');
    // Can now create relationships with custom types
    const a = ds.create({ value: 'a' });
    const b = ds.create({ value: 'b' });
    expect(() => ds.relate(a.id, 'affects', b.id)).not.toThrow();
  });

  it('addRelTypes() rejects invalid names', () => {
    expect(() => ds.addRelTypes(['Bad-Name'])).toThrow(/Invalid relationship type name/);
    expect(() => ds.addRelTypes(['123-start'])).toThrow(/Invalid relationship type name/);
  });

  it('addRelTypes() is idempotent — no duplicates', () => {
    ds.addRelTypes(['affects']);
    ds.addRelTypes(['affects']);
    const count = ds.relTypes.filter(t => t === 'affects').length;
    expect(count).toBe(1);
  });

  it('built-in rel types cannot be duplicated', () => {
    ds.addRelTypes(['depends-on']); // built-in
    expect(ds.relTypes.filter(t => t === 'depends-on').length).toBe(1);
  });

  it('custom rel types survive reopen', () => {
    ds.addRelTypes(['my-type']);
    const ds2 = SqliteFsAdapter.open(tmp);
    expect(ds2.relTypes).toContain('my-type');
  });
});

// ─── history ───────────────────────────────────────────────────────────────────

describe('history', () => {
  it('returns create event with correct snapshot', () => {
    const item = ds.create({ value: 'hello' });
    const h    = ds.history(item.id);
    expect(h.length).toBeGreaterThanOrEqual(1);
    const create = h.find(e => e.changeType === 'create');
    expect(create.value).toBe('hello');
  });

  it('accumulates multiple events', () => {
    const item = ds.create({ value: 'v1' });
    ds.update(item.id, { value: 'v2' });
    ds.softDelete(item.id);
    ds.restore(item.id);
    const types = ds.history(item.id).map(e => e.changeType);
    expect(types).toContain('create');
    expect(types).toContain('update');
    expect(types).toContain('soft-delete');
    expect(types).toContain('restore');
  });

  it('each snapshot contains snapshotAt and changedBy', () => {
    const item = ds.create({ value: 'x' });
    const h    = ds.history(item.id);
    expect(h[0].snapshotAt).toBeDefined();
    expect(h[0].changedBy).toBe('test@example.com');
  });

  it('returns empty array for unknown id', () => {
    expect(ds.history('ffffffff-ffff-4fff-bfff-ffffffffffff')).toEqual([]);
  });
});

// ─── type definitions ──────────────────────────────────────────────────────────

describe('type definitions', () => {
  it('createType() stores and returns metadata + schema', () => {
    const { metadata, schema } = ds.createType('Bug', { icon: 'Category' });
    expect(metadata.value).toBe('Bug');
    expect(metadata.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(schema.jsonSchema.title).toBe('Bug');
  });

  it('readTypeJson() returns the stored schema', () => {
    const { metadata } = ds.createType('Feature', { icon: 'Category' });
    const s = ds.readTypeJson(metadata.id);
    expect(s.jsonSchema.title).toBe('Feature');
  });

  it('writeTypeJson() updates the schema', () => {
    const { metadata } = ds.createType('Task', { icon: 'Category' });
    const next = { meta: { icon: 'Star', description: 'updated' }, custom: true };
    ds.writeTypeJson(metadata.id, next);
    expect(ds.readTypeJson(metadata.id)).toEqual(next);
  });

  it('readTypeJson() returns null for unknown id', () => {
    expect(ds.readTypeJson('ffffffff-ffff-4fff-bfff-ffffffffffff')).toBeNull();
  });

  it('createType() with explicit schema', () => {
    const schema = {
      meta: { icon: '🐛', description: 'A bug', details: '', keywords: '', tags: '', 'ai-instructions': { claude: '' } },
      jsonSchema: { '$schema': 'http://json-schema.org/draft-07/schema#', '$id': '', title: 'Bug', type: 'object', properties: { severity: { type: 'string' } }, required: [], additionalProperties: false },
    };
    const { metadata: m } = ds.createType('Bug', { schema });
    expect(ds.readTypeJson(m.id).meta.icon).toBe('🐛');
  });

  it('resolveTypeId returns primitive for built-in type name', () => {
    expect(ds.resolveTypeId('text')).toEqual({ primitive: true });
  });

  it('resolveTypeId returns { id } for registered custom type', () => {
    const { metadata } = ds.createType('Sprint', { icon: 'Category' });
    const r = ds.resolveTypeId('Sprint');
    expect(r.id).toBe(metadata.id);
  });

  it('resolveTypeId returns { unknown: true } for unregistered name', () => {
    expect(ds.resolveTypeId('Nonexistent')).toEqual({ unknown: true });
  });
});

// ─── objectData / functionData / timeData ──────────────────────────────────────

describe('objectData / functionData / timeData', () => {
  it('readObjectJson returns null for item with no object_data', () => {
    const item = ds.create({ value: 'x' });
    expect(ds.readObjectJson(item.id)).toBeNull();
  });

  it('writeObjectJson / readObjectJson round-trips', () => {
    const item = ds.create({ value: 'x' });
    ds.writeObjectJson(item.id, { key: 'value', arr: [1, 2] });
    expect(ds.readObjectJson(item.id)).toEqual({ key: 'value', arr: [1, 2] });
  });

  it('readObjectJson returns null for synthetic IDs', () => {
    const { metadata: t } = ds.createType('T', { icon: 'Category' });
    const item = ds.create({ value: 'x', type: 'object', typeId: t.id, objectData: { a: 1 } });
    expect(ds.readObjectJson(`${item.id}__a`)).toBeNull();
  });

  it('readFunctionJson returns null when not set', () => {
    const item = ds.create({ value: 'x' });
    expect(ds.readFunctionJson(item.id)).toBeNull();
  });

  it('writeFunctionJson / readFunctionJson round-trips', () => {
    const item = ds.create({ value: 'x', type: 'function' });
    ds.writeFunctionJson(item.id, { source: 'function main(){}', lang: 'ts' });
    expect(ds.readFunctionJson(item.id)).toEqual({ source: 'function main(){}', lang: 'ts' });
  });

  it('runtime field round-trips', () => {
    const item = ds.create({ value: 'fn-rt', type: 'function' });
    ds.writeFunctionJson(item.id, { runtime: 'typescript', description: 'test' });
    expect(ds.readFunctionJson(item.id).runtime).toBe('typescript');
  });

  it('python runtime round-trips', () => {
    const item = ds.create({ value: 'fn-py', type: 'function' });
    ds.writeFunctionJson(item.id, {
      runtime: 'python',
      parameters: [{ name: 'x', type: 'number' }],
      returnType: 'boolean',
    });
    const fn = ds.readFunctionJson(item.id);
    expect(fn.runtime).toBe('python');
    expect(fn.parameters[0].name).toBe('x');
    expect(fn.returnType).toBe('boolean');
  });

  it('bundleHash round-trips', () => {
    const item = ds.create({ value: 'fn-bh', type: 'function' });
    const bundleHash = { typescript: 'sha256:abc123', python: 'sha256:def456' };
    ds.writeFunctionJson(item.id, { runtime: 'typescript', bundleHash });
    expect(ds.readFunctionJson(item.id).bundleHash).toEqual(bundleHash);
  });

  it('runtime can be updated', () => {
    const item = ds.create({ value: 'fn-switch', type: 'function' });
    ds.writeFunctionJson(item.id, { runtime: 'typescript' });
    ds.writeFunctionJson(item.id, { runtime: 'python' });
    expect(ds.readFunctionJson(item.id).runtime).toBe('python');
  });

  it('readTimeJson returns null when not set', () => {
    const item = ds.create({ value: 'x' });
    expect(ds.readTimeJson(item.id)).toBeNull();
  });

  it('writeTimeJson / readTimeJson round-trips', () => {
    const item = ds.create({ value: 'x' });
    const timeData = { main: { startAt: '2026-01-01T00:00:00Z', endAt: null, recurrenceRule: null } };
    ds.writeTimeJson(item.id, timeData);
    expect(ds.readTimeJson(item.id)).toEqual(timeData);
  });

  it('deleteTimeJson clears time_data', () => {
    const item = ds.create({ value: 'x' });
    ds.writeTimeJson(item.id, { main: {} });
    ds.deleteTimeJson(item.id);
    expect(ds.readTimeJson(item.id)).toBeNull();
  });

  it('deleteTimeJson is a no-op if no time_data set', () => {
    const item = ds.create({ value: 'x' });
    expect(() => ds.deleteTimeJson(item.id)).not.toThrow();
  });
});

// ─── byTag / byType ────────────────────────────────────────────────────────────

describe('byTag / byType', () => {
  it('byTag returns matching item IDs', () => {
    const a = ds.create({ value: 'a', tags: ['featured'] });
    ds.create({ value: 'b' });
    expect(ds.byTag('featured')).toContain(a.id);
    expect(ds.byTag('featured')).toHaveLength(1);
  });

  it('byTag returns empty array for unused tag', () => {
    expect(ds.byTag('nonexistent')).toEqual([]);
  });

  it('byTag reflects tag updates', () => {
    const item = ds.create({ value: 'x', tags: ['old'] });
    ds.update(item.id, { tags: ['new'] });
    expect(ds.byTag('old')).not.toContain(item.id);
    expect(ds.byTag('new')).toContain(item.id);
  });

  it('byType returns items with matching typeId', () => {
    const { metadata: t } = ds.createType('Bug', { icon: 'Category' });
    const bug = ds.create({ value: 'bug-1', type: 'object', typeId: t.id });
    ds.create({ value: 'other' });
    expect(ds.byType(t.id)).toContain(bug.id);
    expect(ds.byType(t.id)).toHaveLength(1);
  });

  it('byType returns empty array for unused typeId', () => {
    expect(ds.byType('ffffffff-ffff-4fff-bfff-ffffffffffff')).toEqual([]);
  });
});

// ─── query ─────────────────────────────────────────────────────────────────────

describe('query', () => {
  it('default limit is 50', () => {
    for (let i = 0; i < 60; i++) ds.create({ value: `item-${i}` });
    const results = ds.query({});
    expect(results.length).toBe(50);
  });

  it('explicit limit is honoured', () => {
    ds.create({ value: 'a' });
    ds.create({ value: 'b' });
    ds.create({ value: 'c' });
    expect(ds.query({ limit: 2 }).length).toBe(2);
  });

  it('filters by primitive type', () => {
    ds.create({ value: 'string-one', type: 'string' });
    ds.create({ value: 'text-one',   type: 'text' });
    const results = ds.query({ type: 'string', limit: 100 });
    expect(results.every(i => i.type === 'string')).toBe(true);
    expect(results.some(i => i.value === 'string-one')).toBe(true);
    expect(results.some(i => i.value === 'text-one')).toBe(false);
  });

  it('filters by registered custom type', () => {
    const { metadata: t } = ds.createType('Epic', { icon: 'Category' });
    const bug = ds.create({ value: 'epic-1', type: 'object', typeId: t.id });
    ds.create({ value: 'noise' });
    const results = ds.query({ type: 'Epic', limit: 100 });
    expect(results).toHaveLength(1);
    expect(results[0].id).toBe(bug.id);
  });

  it('unknown type with strictTypes: true throws UnknownTypeError', () => {
    expect(() => ds.query({ type: 'NoSuchType', strictTypes: true })).toThrow(UnknownTypeError);
  });

  it('unknown type without strictTypes returns empty with warning', () => {
    const results = ds.query({ type: 'Bogus', limit: 100 });
    expect(results).toHaveLength(0);
    expect(Object.getOwnPropertyDescriptor(results, 'warning')?.value).toBeDefined();
  });

  it('where clause filters on objectData fields', () => {
    const { metadata: t } = ds.createType('Bug', { icon: 'Category' });
    const b1 = ds.create({ value: 'b1', type: 'object', typeId: t.id, objectData: { severity: 'P1' } });
    ds.create({ value: 'b2', type: 'object', typeId: t.id, objectData: { severity: 'P2' } });
    const results = ds.query({ where: { severity: 'P1' }, limit: 100 });
    expect(results).toHaveLength(1);
    expect(results[0].id).toBe(b1.id);
  });

  it('where clause: "contains" operator', () => {
    const { metadata: t } = ds.createType('Note', { icon: 'Category' });
    const n = ds.create({ value: 'note', type: 'object', typeId: t.id, objectData: { body: 'Hello World' } });
    const results = ds.query({ where: { body: { op: 'contains', value: 'hello' } }, limit: 100 });
    expect(results.some(i => i.id === n.id)).toBe(true);
  });

  it('where clause: "in" operator', () => {
    const { metadata: t } = ds.createType('Task', { icon: 'Category' });
    const a = ds.create({ value: 'a', type: 'object', typeId: t.id, objectData: { status: 'open' } });
    const b = ds.create({ value: 'b', type: 'object', typeId: t.id, objectData: { status: 'closed' } });
    ds.create({ value: 'c', type: 'object', typeId: t.id, objectData: { status: 'archived' } });
    const results = ds.query({ where: { status: { op: 'in', value: ['open', 'closed'] } }, limit: 100 });
    expect(results.map(i => i.id).sort()).toEqual([a.id, b.id].sort());
  });

  it('excludes soft-deleted items by default', () => {
    const item = ds.create({ value: 'x' });
    ds.softDelete(item.id);
    expect(ds.query({ limit: 100 }).some(i => i.id === item.id)).toBe(false);
  });

  it('includeDeleted: true includes soft-deleted items', () => {
    const item = ds.create({ value: 'x' });
    ds.softDelete(item.id);
    expect(ds.query({ includeDeleted: true, limit: 100 }).some(i => i.id === item.id)).toBe(true);
  });

  it('expiredOnly returns only expired items', () => {
    const past   = new Date(Date.now() - 60_000).toISOString();
    const future = new Date(Date.now() + 60_000).toISOString();
    const exp    = ds.create({ value: 'expired' });
    ds.update(exp.id, { expiresAt: past });
    const fresh  = ds.create({ value: 'fresh' });
    ds.update(fresh.id, { expiresAt: future });
    const results = ds.query({ expiredOnly: true, limit: 100 });
    expect(results.some(i => i.id === exp.id)).toBe(true);
    expect(results.some(i => i.id === fresh.id)).toBe(false);
  });

  it('excludeExpired omits items past their expiresAt', () => {
    const past = new Date(Date.now() - 60_000).toISOString();
    const exp  = ds.create({ value: 'x' });
    ds.update(exp.id, { expiresAt: past });
    const results = ds.query({ excludeExpired: true, limit: 100 });
    expect(results.some(i => i.id === exp.id)).toBe(false);
  });

  it('rootId scopes results to subtree', () => {
    const r1 = ds.create({ value: 'r1' });
    const r2 = ds.create({ value: 'r2' });
    ds.create({ value: 'c1', parentId: r1.id });
    ds.create({ value: 'c2', parentId: r2.id });
    const results = ds.query({ rootId: r1.id, limit: 100 });
    expect(results.some(i => i.value === 'c1')).toBe(true);
    expect(results.some(i => i.value === 'c2')).toBe(false);
  });

  it('sort by field ascending', () => {
    const { metadata: t } = ds.createType('Item', { icon: 'Category' });
    ds.create({ value: 'z', type: 'object', typeId: t.id, objectData: { rank: 3 } });
    ds.create({ value: 'a', type: 'object', typeId: t.id, objectData: { rank: 1 } });
    ds.create({ value: 'm', type: 'object', typeId: t.id, objectData: { rank: 2 } });
    const results = ds.query({ type: 'Item', sort: { field: 'rank', dir: 'asc' }, limit: 100 });
    expect(results.map(i => i.objectData.rank)).toEqual([1, 2, 3]);
  });

  it('sort by field descending', () => {
    const { metadata: t } = ds.createType('DItem', { icon: 'Category' });
    ds.create({ value: 'a', type: 'object', typeId: t.id, objectData: { rank: 1 } });
    ds.create({ value: 'b', type: 'object', typeId: t.id, objectData: { rank: 2 } });
    const results = ds.query({ type: 'DItem', sort: { field: 'rank', dir: 'desc' }, limit: 100 });
    expect(results[0].objectData.rank).toBe(2);
  });
});

// ─── loadAll ───────────────────────────────────────────────────────────────────

describe('loadAll', () => {
  it('returns all items including well-known nodes', () => {
    const item = ds.create({ value: 'x' });
    const all  = ds.loadAll();
    expect(all.some(i => i.id === ROOT_ID)).toBe(true);
    expect(all.some(i => i.id === item.id)).toBe(true);
  });
});

// ─── rebuildIndexes ────────────────────────────────────────────────────────────

describe('rebuildIndexes', () => {
  it('returns item count', () => {
    ds.create({ value: 'a' });
    ds.create({ value: 'b' });
    const count = ds.rebuildIndexes();
    expect(count).toBeGreaterThanOrEqual(2);
  });

  it('re-populates item_tags', () => {
    const item = ds.create({ value: 'x', tags: ['important'] });
    // Manually corrupt by deleting the tag row
    ds._openDb().prepare('DELETE FROM item_tags WHERE item_id = ?').run(item.id);
    expect(ds.byTag('important')).not.toContain(item.id);
    // Rebuild
    ds.rebuildIndexes();
    expect(ds.byTag('important')).toContain(item.id);
  });

  it('re-populates backlinks', () => {
    const target = ds.create({ value: 'target' });
    const linker = ds.create({ value: `[[${target.id}]]` });
    // Corrupt
    ds._openDb().prepare('DELETE FROM backlinks WHERE source_id = ?').run(linker.id);
    expect(ds.backlinks(target.id)).not.toContain(linker.id);
    // Rebuild
    ds.rebuildIndexes();
    expect(ds.backlinks(target.id)).toContain(linker.id);
  });
});

// ─── checkIntegrity ────────────────────────────────────────────────────────────

describe('checkIntegrity', () => {
  it('returns empty findings for a clean datastore', () => {
    expect(ds.checkIntegrity()).toEqual([]);
  });

  it('detects orphan-type-id (item with typeId but no type definition)', () => {
    const fake = 'ffffffff-ffff-4fff-bfff-ffffffffffff';
    // Bypass the guard by inserting directly
    const item = ds.create({ value: 'x' }); // plain item
    ds._openDb().prepare("UPDATE items SET type = 'object', type_id = ? WHERE id = ?").run(fake, item.id);
    const findings = ds.checkIntegrity();
    expect(findings.some(f => f.check === 'orphan-type-id' && f.nodeId === item.id)).toBe(true);
  });

  it('runs only requested checks', () => {
    const findings = ds.checkIntegrity({ checks: ['orphan-type-id'] });
    expect(Array.isArray(findings)).toBe(true);
  });

  it('clean typed object has no orphan finding', () => {
    const { metadata: t } = ds.createType('Clean', { icon: 'Category' });
    ds.create({ value: 'x', type: 'object', typeId: t.id });
    expect(ds.checkIntegrity()).toEqual([]);
  });
});

// ─── well-known node protection ────────────────────────────────────────────────

describe('well-known node protection', () => {
  it('cannot delete ROOT_ID', () => {
    expect(() => ds.delete(ROOT_ID)).toThrow(/reserved root node/);
  });

  it('cannot delete the reserved types node', () => {
    const types = ds.get('11111111-1111-1111-1111-111111111111');
    expect(() => ds.delete(types.id)).toThrow(/reserved root node/);
  });

  it('cannot update the reserved types node', () => {
    const types = ds.get('11111111-1111-1111-1111-111111111111');
    expect(() => ds.update(types.id, { value: 'x' })).toThrow(/reserved root node/);
  });
});

// ─── persistence across reopen ─────────────────────────────────────────────────

describe('persistence across reopen', () => {
  it('items survive a close and reopen', () => {
    const item = ds.create({ value: 'persistent' });
    const ds2  = SqliteFsAdapter.open(tmp);
    expect(ds2.get(item.id)?.value).toBe('persistent');
  });

  it('aliases survive reopen', () => {
    const item = ds.create({ value: 'x' });
    ds.setAlias('keep', item.id);
    const ds2 = SqliteFsAdapter.open(tmp);
    expect(ds2.resolveAlias('keep')).toBe(item.id);
  });

  it('tags survive reopen', () => {
    const item = ds.create({ value: 'x', tags: ['important'] });
    const ds2  = SqliteFsAdapter.open(tmp);
    expect(ds2.byTag('important')).toContain(item.id);
  });

  it('history survives reopen', () => {
    const item = ds.create({ value: 'x' });
    ds.update(item.id, { value: 'y' });
    const ds2 = SqliteFsAdapter.open(tmp);
    expect(ds2.history(item.id).length).toBeGreaterThanOrEqual(2);
  });

  it('time data survives reopen', () => {
    const item = ds.create({ value: 'x' });
    ds.writeTimeJson(item.id, { main: { startAt: '2026-01-01T00:00:00Z' } });
    const ds2 = SqliteFsAdapter.open(tmp);
    expect(ds2.readTimeJson(item.id)).toEqual({ main: { startAt: '2026-01-01T00:00:00Z' } });
  });

  it('materialized paths survive reopen', () => {
    const item    = ds.create({ value: 'x' });
    const pathB4  = ds._getPath(item.id);
    const ds2     = SqliteFsAdapter.open(tmp);
    expect(ds2._getPath(item.id)).toBe(pathB4);
  });
});

// ─── sourceSystem / sourceExternalId ──────────────────────────────────────────

describe('sourceSystem and sourceExternalId', () => {
  it('default to null on a freshly created item', () => {
    const item = ds.create({ value: 'x' });
    expect(item.sourceSystem).toBeNull();
    expect(item.sourceExternalId).toBeNull();
  });

  it('round-trip via update + get', () => {
    const item = ds.create({ value: 'x' });
    ds.update(item.id, { sourceSystem: 'jira', sourceExternalId: 'ENG-42' });
    const got = ds.get(item.id);
    expect(got.sourceSystem).toBe('jira');
    expect(got.sourceExternalId).toBe('ENG-42');
  });

  it('can be cleared back to null', () => {
    const item = ds.create({ value: 'x' });
    ds.update(item.id, { sourceSystem: 'jira', sourceExternalId: 'ENG-1' });
    ds.update(item.id, { sourceSystem: null, sourceExternalId: null });
    const got = ds.get(item.id);
    expect(got.sourceSystem).toBeNull();
    expect(got.sourceExternalId).toBeNull();
  });

  it('survive reopen', () => {
    const item = ds.create({ value: 'x' });
    ds.update(item.id, { sourceSystem: 'github', sourceExternalId: 'issue/99' });
    const ds2 = SqliteFsAdapter.open(tmp);
    const got = ds2.get(item.id);
    expect(got.sourceSystem).toBe('github');
    expect(got.sourceExternalId).toBe('issue/99');
  });

  it('enforces uniqueness — same (system, externalId) pair throws', () => {
    const a = ds.create({ value: 'a' });
    const b = ds.create({ value: 'b' });
    ds.update(a.id, { sourceSystem: 'jira', sourceExternalId: 'ENG-1' });
    expect(() => ds.update(b.id, { sourceSystem: 'jira', sourceExternalId: 'ENG-1' }))
      .toThrow();
  });

  it('allows same externalId under different systems', () => {
    const a = ds.create({ value: 'a' });
    const b = ds.create({ value: 'b' });
    ds.update(a.id, { sourceSystem: 'jira',   sourceExternalId: 'ENG-1' });
    ds.update(b.id, { sourceSystem: 'github', sourceExternalId: 'ENG-1' });
    expect(ds.get(a.id).sourceSystem).toBe('jira');
    expect(ds.get(b.id).sourceSystem).toBe('github');
  });
});

// ─── listStubs ────────────────────────────────────────────────────────────────

describe('listStubs', () => {
  function mkConn() {
    const c = ds.create({ type: 'connector', value: 'Conn' });
    ds.writeObjectJson(c.id, { system: 'test' });
    return c;
  }

  it('returns all stub items for a connector', () => {
    const conn = mkConn();
    const a = ds.create({ value: 'a' });
    const b = ds.create({ value: 'b' });
    ds.update(a.id, { connectorId: conn.id, materialized: false });
    ds.update(b.id, { connectorId: conn.id, materialized: false });

    const stubs = ds.listStubs(conn.id);
    const ids   = stubs.map(s => s.id);
    expect(ids).toContain(a.id);
    expect(ids).toContain(b.id);
    expect(stubs.every(s => s.materialized === false)).toBe(true);
  });

  it('excludes materialized items', () => {
    const conn = mkConn();
    const stub = ds.create({ value: 'stub' });
    const real = ds.create({ value: 'real' });
    ds.update(stub.id, { connectorId: conn.id, materialized: false });
    ds.update(real.id, { connectorId: conn.id, materialized: true });

    const stubs = ds.listStubs(conn.id);
    expect(stubs.map(s => s.id)).toContain(stub.id);
    expect(stubs.map(s => s.id)).not.toContain(real.id);
  });

  it('excludes items from a different connector', () => {
    const conn1 = mkConn();
    const conn2 = mkConn();
    const item  = ds.create({ value: 'x' });
    ds.update(item.id, { connectorId: conn1.id, materialized: false });

    expect(ds.listStubs(conn2.id)).toHaveLength(0);
  });

  it('excludes deleted stubs', () => {
    const conn = mkConn();
    const item = ds.create({ value: 'x' });
    ds.update(item.id, { connectorId: conn.id, materialized: false });
    ds.delete(item.id);

    expect(ds.listStubs(conn.id)).toHaveLength(0);
  });

  it('returns empty array when connector has no stubs', () => {
    const conn = mkConn();
    expect(ds.listStubs(conn.id)).toEqual([]);
  });
});

// ─── listDueForRefresh ────────────────────────────────────────────────────────

describe('listDueForRefresh', () => {
  function mkConn() {
    const c = ds.create({ type: 'connector', value: 'Conn' });
    ds.writeObjectJson(c.id, { system: 'test' });
    return c;
  }

  it('returns connector items cached before beforeAt', () => {
    const conn = mkConn();
    const item = ds.create({ value: 'x' });
    ds.update(item.id, {
      connectorId: conn.id,
      materialized: true,
      cachedAt: '2025-01-01T00:00:00Z',
    });

    const due = ds.listDueForRefresh('2026-01-01T00:00:00Z');
    expect(due.map(d => d.id)).toContain(item.id);
  });

  it('excludes items cached after beforeAt', () => {
    const conn = mkConn();
    const item = ds.create({ value: 'x' });
    ds.update(item.id, {
      connectorId: conn.id,
      materialized: true,
      cachedAt: '2026-06-01T00:00:00Z',
    });

    const due = ds.listDueForRefresh('2026-01-01T00:00:00Z');
    expect(due.map(d => d.id)).not.toContain(item.id);
  });

  it('excludes native items (no connectorId)', () => {
    const item = ds.create({ value: 'native' });
    ds.update(item.id, { cachedAt: '2020-01-01T00:00:00Z' });

    const due = ds.listDueForRefresh('2099-01-01T00:00:00Z');
    expect(due.map(d => d.id)).not.toContain(item.id);
  });

  it('excludes deleted items', () => {
    const conn = mkConn();
    const item = ds.create({ value: 'x' });
    ds.update(item.id, {
      connectorId: conn.id,
      materialized: true,
      cachedAt: '2025-01-01T00:00:00Z',
    });
    ds.delete(item.id);

    expect(ds.listDueForRefresh('2026-01-01T00:00:00Z')).toHaveLength(0);
  });

  it('includes stubs (materialized=false) that are overdue', () => {
    const conn = mkConn();
    const item = ds.create({ value: 'x' });
    ds.update(item.id, {
      connectorId: conn.id,
      materialized: false,
      cachedAt: '2025-01-01T00:00:00Z',
    });

    const due = ds.listDueForRefresh('2026-01-01T00:00:00Z');
    expect(due.map(d => d.id)).toContain(item.id);
  });

  it('returns empty array when nothing is stale', () => {
    expect(ds.listDueForRefresh('2000-01-01T00:00:00Z')).toEqual([]);
  });

  it('listDueSchedules returns active schedules due at/before the cutoff', () => {
    const due    = ds.create({ type: 'schedule', status: 'active', value: 'due',    dueAt: '2020-01-01T00:00:00.000Z' });
    const notYet = ds.create({ type: 'schedule', status: 'active', value: 'notYet', dueAt: '2999-01-01T00:00:00.000Z' });
    const paused = ds.create({ type: 'schedule', status: 'paused', value: 'paused', dueAt: '2020-01-01T00:00:00.000Z' });

    const ids = ds.listDueSchedules('2025-01-01T00:00:00.000Z').map((r: any) => r.id);

    expect(ids).toContain(due.id);
    expect(ids).not.toContain(notYet.id);   // future due date
    expect(ids).not.toContain(paused.id);   // not active
  });
});
