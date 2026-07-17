// Postgres branching tests — run against a real Postgres instance.
//
//   docker compose -f docker-compose.test.yml up -d
//   npm test
//
// Every describe block gets its own schema so failures are fully isolated.

import * as crypto from 'crypto';
import { Pool } from 'pg';
import { PostgresAdapter, ROOT_ID } from '../src/adapter';

const CONNECTION_STRING =
  process.env.KANECTA_TEST_PG_URL || 'postgres://kanecta:kanecta@localhost:45432/kanecta';

const OWNER = 'test@example.com';

// Helper — spin up an isolated schema + adapter, run fn, then tear down.
// Convenience wrapper: create an item without specifying every field.
async function createItem(adapter, { value, parentId, type = 'text' } = {}) {
  return adapter.create({ value, parentId, type });
}

async function withAdapter(fn) {
  const schema    = `br_test_${crypto.randomBytes(4).toString('hex')}`;
  const adminPool = new Pool({ connectionString: CONNECTION_STRING });
  await adminPool.query(`CREATE SCHEMA "${schema}"`);
  const pool    = new Pool({ connectionString: CONNECTION_STRING, options: `-c search_path="${schema}"` });
  const adapter = await PostgresAdapter.init(pool, OWNER);
  try {
    await fn(adapter, pool);
  } finally {
    await pool.end();
    await adminPool.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
    await adminPool.end();
  }
}

// ─── Branch lifecycle ──────────────────────────────────────────────────────────

describe('branch lifecycle', () => {
  test('listBranches returns empty array on fresh adapter', async () => {
    await withAdapter(async (adapter) => {
      const branches = await adapter.listBranches();
      expect(branches).toEqual([]);
    });
  }, 30_000);

  test('createBranch returns id, name, baseBranch, createdAt', async () => {
    await withAdapter(async (adapter) => {
      const branch = await adapter.createBranch('feature/foo');
      expect(branch.id).toBeTruthy();
      expect(branch.name).toBe('feature/foo');
      expect(branch.baseBranch).toBe('main');
      expect(branch.createdAt).toBeTruthy();
      expect(new Date(branch.createdAt).getFullYear()).toBeGreaterThan(2020);
    });
  }, 30_000);

  test('listBranches returns the created branch', async () => {
    await withAdapter(async (adapter) => {
      await adapter.createBranch('alpha');
      await adapter.createBranch('beta');
      const branches = await adapter.listBranches();
      expect(branches).toHaveLength(2);
      const names = branches.map(b => b.name).sort();
      expect(names).toEqual(['alpha', 'beta']);
    });
  }, 30_000);

  test('listBranches result includes baseBranch and createdAt', async () => {
    await withAdapter(async (adapter) => {
      await adapter.createBranch('feat/x');
      const [b] = await adapter.listBranches();
      expect(b.baseBranch).toBe('main');
      expect(typeof b.createdAt).toBe('string');
      expect(b.mergedAt).toBeNull();
    });
  }, 30_000);

  test('createBranch throws for duplicate name', async () => {
    await withAdapter(async (adapter) => {
      await adapter.createBranch('dupe');
      await expect(adapter.createBranch('dupe')).rejects.toThrow(/already exists/);
    });
  }, 30_000);

  test('createBranch throws for empty name', async () => {
    await withAdapter(async (adapter) => {
      await expect(adapter.createBranch('')).rejects.toThrow(/required/);
      await expect(adapter.createBranch('  ')).rejects.toThrow(/required/);
    });
  }, 30_000);

  test('createBranch throws for name "main"', async () => {
    await withAdapter(async (adapter) => {
      await expect(adapter.createBranch('main')).rejects.toThrow(/main/);
    });
  }, 30_000);

  test('getBranch returns branch by name', async () => {
    await withAdapter(async (adapter) => {
      const created = await adapter.createBranch('lookup-me');
      const found   = await adapter.getBranch('lookup-me');
      expect(found.id).toBe(created.id);
      expect(found.name).toBe('lookup-me');
    });
  }, 30_000);

  test('getBranch returns null for missing branch', async () => {
    await withAdapter(async (adapter) => {
      const found = await adapter.getBranch('does-not-exist');
      expect(found).toBeNull();
    });
  }, 30_000);

  test('deleteBranch soft-deletes and removes from listBranches', async () => {
    await withAdapter(async (adapter) => {
      await adapter.createBranch('to-delete');
      await adapter.deleteBranch('to-delete');
      const branches = await adapter.listBranches();
      expect(branches.find(b => b.name === 'to-delete')).toBeUndefined();
    });
  }, 30_000);

  test('deleteBranch clears branch_changes for that branch', async () => {
    await withAdapter(async (adapter, pool) => {
      const br = await adapter.createBranch('cleanup-test');
      await adapter.applyBranchChanges(br.id, [
        { itemId: '11111111-1111-1111-1111-111111111111', changeType: 'create', section: 'item', data: { value: 'x' } },
      ]);
      await adapter.deleteBranch('cleanup-test');
      const { rows } = await pool.query('SELECT * FROM branch_changes WHERE branch_id = $1', [br.id]);
      expect(rows).toHaveLength(0);
    });
  }, 30_000);

  test('deleteBranch throws for "main"', async () => {
    await withAdapter(async (adapter) => {
      await expect(adapter.deleteBranch('main')).rejects.toThrow(/main/);
    });
  }, 30_000);

  test('deleteBranch throws for non-existent branch', async () => {
    await withAdapter(async (adapter) => {
      await expect(adapter.deleteBranch('ghost')).rejects.toThrow(/not found/);
    });
  }, 30_000);
});

// ─── applyBranchChanges / getBranchChanges ────────────────────────────────────

describe('applyBranchChanges / getBranchChanges', () => {
  const ITEM_A = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
  const ITEM_B = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';

  test('applyBranchChanges stores rows retrievable by getBranchChanges', async () => {
    await withAdapter(async (adapter) => {
      const br = await adapter.createBranch('write-test');
      await adapter.applyBranchChanges(br.id, [
        { itemId: ITEM_A, changeType: 'create', section: 'item', data: { value: 'hello', type: 'text' } },
        { itemId: ITEM_A, changeType: 'create', section: 'meta', data: { createdBy: OWNER } },
      ]);
      const changes = await adapter.getBranchChanges(br.id);
      expect(changes).toHaveLength(2);
      const sections = changes.map(c => c.section).sort();
      expect(sections).toEqual(['item', 'meta']);
    });
  }, 30_000);

  test('getBranchChanges returns correct changeType and data', async () => {
    await withAdapter(async (adapter) => {
      const br = await adapter.createBranch('data-check');
      const payload = { foo: 'bar', num: 42 };
      await adapter.applyBranchChanges(br.id, [
        { itemId: ITEM_A, changeType: 'update', section: 'payload', data: payload },
      ]);
      const [change] = await adapter.getBranchChanges(br.id);
      expect(change.itemId).toBe(ITEM_A);
      expect(change.changeType).toBe('update');
      expect(change.section).toBe('payload');
      expect(change.data).toMatchObject(payload);
    });
  }, 30_000);

  test('upsert on conflict: later call wins for same (branch, item, section)', async () => {
    await withAdapter(async (adapter) => {
      const br = await adapter.createBranch('upsert-test');
      await adapter.applyBranchChanges(br.id, [
        { itemId: ITEM_A, changeType: 'create', section: 'item', data: { value: 'v1' } },
      ]);
      await adapter.applyBranchChanges(br.id, [
        { itemId: ITEM_A, changeType: 'update', section: 'item', data: { value: 'v2' } },
      ]);
      const changes = await adapter.getBranchChanges(br.id);
      expect(changes).toHaveLength(1);
      expect(changes[0].changeType).toBe('update');
      expect(changes[0].data.value).toBe('v2');
    });
  }, 30_000);

  test('applyBranchChanges handles multiple items', async () => {
    await withAdapter(async (adapter) => {
      const br = await adapter.createBranch('multi-item');
      await adapter.applyBranchChanges(br.id, [
        { itemId: ITEM_A, changeType: 'create', section: 'item', data: { value: 'a' } },
        { itemId: ITEM_B, changeType: 'create', section: 'item', data: { value: 'b' } },
      ]);
      const changes = await adapter.getBranchChanges(br.id);
      expect(changes).toHaveLength(2);
      const ids = changes.map(c => c.itemId).sort();
      expect(ids).toEqual([ITEM_A, ITEM_B].sort());
    });
  }, 30_000);

  test('applyBranchChanges is a no-op for empty array', async () => {
    await withAdapter(async (adapter) => {
      const br = await adapter.createBranch('empty-apply');
      await adapter.applyBranchChanges(br.id, []);
      const changes = await adapter.getBranchChanges(br.id);
      expect(changes).toHaveLength(0);
    });
  }, 30_000);

  test('getBranchChanges for unknown branchId returns empty array', async () => {
    await withAdapter(async (adapter) => {
      const changes = await adapter.getBranchChanges('00000000-dead-beef-0000-000000000000');
      expect(changes).toHaveLength(0);
    });
  }, 30_000);

  test('delete changeType records correctly', async () => {
    await withAdapter(async (adapter) => {
      const br = await adapter.createBranch('delete-marker');
      await adapter.applyBranchChanges(br.id, [
        { itemId: ITEM_A, changeType: 'delete', section: 'item', data: null },
      ]);
      const changes = await adapter.getBranchChanges(br.id);
      expect(changes).toHaveLength(1);
      expect(changes[0].changeType).toBe('delete');
      expect(changes[0].data).toBeNull();
    });
  }, 30_000);
});

// ─── preFlightScan ────────────────────────────────────────────────────────────

describe('preFlightScan', () => {
  test('empty branch has empty summary and is not blocked', async () => {
    await withAdapter(async (adapter) => {
      const br = await adapter.createBranch('empty-scan');
      const result = await adapter.preFlightScan(br.id);
      expect(result.branchId).toBe(br.id);
      expect(result.summary).toEqual({ adds: 0, edits: 0, deletes: 0 });
      expect(result.blocked).toBe(false);
      expect(result.blockingRefs).toHaveLength(0);
      expect(result.structuralRefs).toHaveLength(0);
    });
  }, 30_000);

  test('preFlightScan counts adds, edits, deletes correctly', async () => {
    await withAdapter(async (adapter) => {
      const br = await adapter.createBranch('counts');
      await adapter.applyBranchChanges(br.id, [
        { itemId: 'aaaa0001-0000-0000-0000-000000000000', changeType: 'create', section: 'item', data: { value: 'new' } },
        { itemId: 'aaaa0002-0000-0000-0000-000000000000', changeType: 'update', section: 'item', data: { value: 'changed' } },
        { itemId: 'aaaa0003-0000-0000-0000-000000000000', changeType: 'delete', section: 'item', data: null },
      ]);
      const result = await adapter.preFlightScan(br.id);
      expect(result.summary.adds).toBe(1);
      expect(result.summary.edits).toBe(1);
      expect(result.summary.deletes).toBe(1);
    });
  }, 30_000);

  test('preFlightScan is not blocked when no blockDeletion references exist', async () => {
    await withAdapter(async (adapter) => {
      const br = await adapter.createBranch('no-block');
      await adapter.applyBranchChanges(br.id, [
        { itemId: 'dddd0001-0000-0000-0000-000000000000', changeType: 'delete', section: 'item', data: null },
      ]);
      const result = await adapter.preFlightScan(br.id);
      expect(result.blocked).toBe(false);
    });
  }, 30_000);

  test('preFlightScan returns structural refs for items in perf_references', async () => {
    await withAdapter(async (adapter, pool) => {
      // Seed a real item and then a perf_references row pointing to it
      const parent = await createItem(adapter, { value:'parent', parentId: ROOT_ID, type: 'text' });
      const child  = await createItem(adapter, { value:'child', parentId: parent.id, type: 'text' });

      // Manually seed perf_references — adapter seedbeds parent ref
      // but we also add an inline-link ref to prove the query works
      await pool.query(
        'INSERT INTO perf_references (source_item_id, target_item_id, reference_type) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING',
        [child.id, parent.id, 'inline-link'],
      );

      const br = await adapter.createBranch('blast-radius');
      // The branch "edits" parent — so child's ref to parent should appear in structuralRefs
      await adapter.applyBranchChanges(br.id, [
        { itemId: parent.id, changeType: 'update', section: 'item', data: { value: 'parent-v2' } },
      ]);

      const result = await adapter.preFlightScan(br.id);
      const refTargets = result.structuralRefs.map(r => r.targetId);
      expect(refTargets).toContain(parent.id);
    });
  }, 30_000);
});

// ─── mergeBranch ──────────────────────────────────────────────────────────────

describe('mergeBranch', () => {
  test('merging a create branch_change inserts item into main tables', async () => {
    await withAdapter(async (adapter, pool) => {
      // We create a real item via the adapter on main, then simulate a branch that
      // adds a *second* item by writing change records manually.
      const existing = await createItem(adapter, { value:'existing', parentId: ROOT_ID, type: 'text' });
      const br = await adapter.createBranch('merge-create');

      const newItemId = 'cccc0001-0000-0000-0000-000000000001';
      await adapter.applyBranchChanges(br.id, [
        { itemId: newItemId, changeType: 'create', section: 'item',
          data: { value: 'branch-created', type: 'text', parentId: existing.id, sortOrder: 0 } },
        { itemId: newItemId, changeType: 'create', section: 'meta',
          data: { specVersion: '1.4.0', createdBy: OWNER, visibility: 'private', tags: [] } },
      ]);

      const result = await adapter.mergeBranch(br.id);
      expect(result.merged).toBe(1);
      expect(result.branchName).toBe('merge-create');

      const { rows } = await pool.query('SELECT value FROM items WHERE id = $1', [newItemId]);
      expect(rows).toHaveLength(1);
      expect(rows[0].value).toBe('branch-created');
    });
  }, 30_000);

  test('merging an update branch_change modifies item in main tables', async () => {
    await withAdapter(async (adapter, pool) => {
      const item = await createItem(adapter, { value:'original', parentId: ROOT_ID, type: 'text' });
      const br   = await adapter.createBranch('merge-update');

      await adapter.applyBranchChanges(br.id, [
        { itemId: item.id, changeType: 'update', section: 'item', data: { value: 'updated' } },
      ]);

      await adapter.mergeBranch(br.id);

      const { rows } = await pool.query('SELECT value FROM items WHERE id = $1', [item.id]);
      expect(rows[0].value).toBe('updated');
    });
  }, 30_000);

  test('merging a delete branch_change removes item from main tables', async () => {
    await withAdapter(async (adapter, pool) => {
      const item = await createItem(adapter, { value:'doomed', parentId: ROOT_ID, type: 'text' });
      const br   = await adapter.createBranch('merge-delete');

      await adapter.applyBranchChanges(br.id, [
        { itemId: item.id, changeType: 'delete', section: 'item', data: null },
      ]);

      await adapter.mergeBranch(br.id);

      const { rows } = await pool.query('SELECT id FROM items WHERE id = $1', [item.id]);
      expect(rows).toHaveLength(0);
    });
  }, 30_000);

  test('mergeBranch marks branch merged_at and removes branch_changes', async () => {
    await withAdapter(async (adapter, pool) => {
      const br = await adapter.createBranch('merged-mark');
      const newItemId = 'cccc0002-0000-0000-0000-000000000002';
      await adapter.applyBranchChanges(br.id, [
        { itemId: newItemId, changeType: 'create', section: 'item',
          data: { value: 'temp', type: 'text', parentId: ROOT_ID, sortOrder: 0 } },
      ]);

      await adapter.mergeBranch(br.id);

      const { rows: branchRows } = await pool.query('SELECT merged_at FROM branches WHERE id = $1', [br.id]);
      expect(branchRows[0].merged_at).not.toBeNull();

      const { rows: changeRows } = await pool.query('SELECT * FROM branch_changes WHERE branch_id = $1', [br.id]);
      expect(changeRows).toHaveLength(0);
    });
  }, 30_000);

  test('mergeBranch merged branch no longer appears in listBranches', async () => {
    await withAdapter(async (adapter) => {
      const br = await adapter.createBranch('to-merge');
      await adapter.mergeBranch(br.id);
      // mergedAt is set but deleted_at is not — still visible but marked merged
      // listBranches shows deleted_at IS NULL, which merged branches satisfy
      const branches = await adapter.listBranches();
      const merged = branches.find(b => b.name === 'to-merge');
      expect(merged).toBeTruthy();
      expect(merged.mergedAt).not.toBeNull();
    });
  }, 30_000);

  test('mergeBranch throws for already-merged branch', async () => {
    await withAdapter(async (adapter) => {
      const br = await adapter.createBranch('merge-twice');
      await adapter.mergeBranch(br.id);
      await expect(adapter.mergeBranch(br.id)).rejects.toThrow(/already merged/);
    });
  }, 30_000);

  test('mergeBranch throws for non-existent branchId', async () => {
    await withAdapter(async (adapter) => {
      await expect(adapter.mergeBranch('00000000-dead-beef-0000-000000000000')).rejects.toThrow();
    });
  }, 30_000);

  test('merge is atomic: if one change fails the whole merge rolls back', async () => {
    await withAdapter(async (adapter, pool) => {
      const br     = await adapter.createBranch('atomic-merge');
      const goodId = 'cccc0003-0000-0000-0000-000000000003';
      const badId  = 'cccc0003-0000-0000-0000-000000000099';
      // non-existent parent — FK (DEFERRABLE INITIALLY DEFERRED) fires at COMMIT
      const GHOST_PARENT = '99999999-9999-9999-9999-999999999999';

      await adapter.applyBranchChanges(br.id, [
        // valid create — should be rolled back if the second fails
        { itemId: goodId, changeType: 'create', section: 'item',
          data: { value: 'good', type: 'text', parentId: ROOT_ID, sortOrder: 0 } },
        { itemId: goodId, changeType: 'create', section: 'meta',
          data: { specVersion: '1.4.0', visibility: 'private', tags: [] } },
        // create referencing a non-existent parent → FK violation at commit
        { itemId: badId, changeType: 'create', section: 'item',
          data: { value: 'bad', type: 'text', parentId: GHOST_PARENT, sortOrder: 0 } },
        { itemId: badId, changeType: 'create', section: 'meta',
          data: { specVersion: '1.4.0', visibility: 'private', tags: [] } },
      ]);

      await expect(adapter.mergeBranch(br.id)).rejects.toThrow();

      // Verify the good item was NOT inserted (transaction rolled back)
      const { rows } = await pool.query('SELECT id FROM items WHERE id = $1', [goodId]);
      expect(rows).toHaveLength(0);
    });
  }, 30_000);

  test('mergeBranch with payload section still creates item correctly', async () => {
    await withAdapter(async (adapter, pool) => {
      const existing = await createItem(adapter, { value:'host', parentId: ROOT_ID, type: 'text' });
      const br = await adapter.createBranch('merge-payload');
      const newId = 'cccc0004-0000-0000-0000-000000000004';

      await adapter.applyBranchChanges(br.id, [
        { itemId: newId, changeType: 'create', section: 'item',
          data: { value: 'with-payload', type: 'text', parentId: existing.id, sortOrder: 0 } },
        { itemId: newId, changeType: 'create', section: 'meta',
          data: { specVersion: '1.4.0', visibility: 'private', tags: [] } },
        // payload section is stored in branch_changes but not applied to a separate table —
        // it's carried through branch_changes for SyncEngine use
        { itemId: newId, changeType: 'create', section: 'payload',
          data: { key: 'value', nested: { x: 1 } } },
      ]);

      const result = await adapter.mergeBranch(br.id);
      expect(result.merged).toBe(1);

      const { rows } = await pool.query('SELECT value FROM items WHERE id = $1', [newId]);
      expect(rows).toHaveLength(1);
      expect(rows[0].value).toBe('with-payload');
    });
  }, 30_000);

  test('mixed create+update+delete all apply correctly in one merge', async () => {
    await withAdapter(async (adapter, pool) => {
      const keep   = await createItem(adapter, { value:'keep-original', parentId: ROOT_ID, type: 'text' });
      const remove = await createItem(adapter, { value:'remove', parentId: ROOT_ID, type: 'text' });
      const br     = await adapter.createBranch('mixed-merge');
      const newId  = 'cccc0005-0000-0000-0000-000000000005';

      await adapter.applyBranchChanges(br.id, [
        // create new
        { itemId: newId,     changeType: 'create', section: 'item', data: { value: 'new-item', type: 'text', parentId: ROOT_ID, sortOrder: 0 } },
        { itemId: newId,     changeType: 'create', section: 'meta', data: { specVersion: '1.4.0', createdBy: OWNER, visibility: 'private', tags: [] } },
        // edit keep
        { itemId: keep.id,   changeType: 'update', section: 'item', data: { value: 'keep-updated' } },
        // delete remove
        { itemId: remove.id, changeType: 'delete', section: 'item', data: null },
      ]);

      const result = await adapter.mergeBranch(br.id);
      expect(result.merged).toBe(3);

      const { rows: newRows } = await pool.query('SELECT value FROM items WHERE id = $1', [newId]);
      expect(newRows[0].value).toBe('new-item');

      const { rows: keepRows } = await pool.query('SELECT value FROM items WHERE id = $1', [keep.id]);
      expect(keepRows[0].value).toBe('keep-updated');

      const { rows: delRows } = await pool.query('SELECT id FROM items WHERE id = $1', [remove.id]);
      expect(delRows).toHaveLength(0);
    });
  }, 30_000);
});

// ─── Multiple branches isolation ───────────────────────────────────────────────

describe('multiple branches isolation', () => {
  const ITEM_X = 'eeee0001-0000-0000-0000-000000000001';
  const ITEM_Y = 'eeee0002-0000-0000-0000-000000000002';

  test('branch_changes are scoped to their branch — different branches do not bleed', async () => {
    await withAdapter(async (adapter) => {
      const br1 = await adapter.createBranch('iso-alpha');
      const br2 = await adapter.createBranch('iso-beta');

      await adapter.applyBranchChanges(br1.id, [
        { itemId: ITEM_X, changeType: 'create', section: 'item', data: { value: 'alpha-x' } },
      ]);
      await adapter.applyBranchChanges(br2.id, [
        { itemId: ITEM_Y, changeType: 'create', section: 'item', data: { value: 'beta-y' } },
      ]);

      const ch1 = await adapter.getBranchChanges(br1.id);
      const ch2 = await adapter.getBranchChanges(br2.id);

      expect(ch1).toHaveLength(1);
      expect(ch1[0].itemId).toBe(ITEM_X);

      expect(ch2).toHaveLength(1);
      expect(ch2[0].itemId).toBe(ITEM_Y);
    });
  }, 30_000);

  test('deleting one branch does not affect another branch', async () => {
    await withAdapter(async (adapter) => {
      const br1 = await adapter.createBranch('survives');
      const br2 = await adapter.createBranch('gets-deleted');

      await adapter.applyBranchChanges(br1.id, [
        { itemId: ITEM_X, changeType: 'create', section: 'item', data: { value: 'still-here' } },
      ]);

      await adapter.deleteBranch('gets-deleted');

      const ch1 = await adapter.getBranchChanges(br1.id);
      expect(ch1).toHaveLength(1);

      const branches = await adapter.listBranches();
      expect(branches.find(b => b.name === 'survives')).toBeTruthy();
      expect(branches.find(b => b.name === 'gets-deleted')).toBeUndefined();
    });
  }, 30_000);

  test('merging one branch does not affect another branch', async () => {
    await withAdapter(async (adapter, pool) => {
      const existing = await createItem(adapter, { value:'base', parentId: ROOT_ID, type: 'text' });
      const br1 = await adapter.createBranch('merge-first');
      const br2 = await adapter.createBranch('merge-second');

      const id1 = 'eeee0003-0000-0000-0000-000000000003';
      const id2 = 'eeee0004-0000-0000-0000-000000000004';

      await adapter.applyBranchChanges(br1.id, [
        { itemId: id1, changeType: 'create', section: 'item', data: { value: 'br1-item', type: 'text', parentId: existing.id, sortOrder: 0 } },
        { itemId: id1, changeType: 'create', section: 'meta', data: { specVersion: '1.4.0', createdBy: OWNER, visibility: 'private', tags: [] } },
      ]);
      await adapter.applyBranchChanges(br2.id, [
        { itemId: id2, changeType: 'create', section: 'item', data: { value: 'br2-item', type: 'text', parentId: existing.id, sortOrder: 1 } },
        { itemId: id2, changeType: 'create', section: 'meta', data: { specVersion: '1.4.0', createdBy: OWNER, visibility: 'private', tags: [] } },
      ]);

      await adapter.mergeBranch(br1.id);

      // br2 changes must be untouched
      const ch2 = await adapter.getBranchChanges(br2.id);
      expect(ch2.length).toBeGreaterThan(0);
      expect(ch2[0].itemId).toBe(id2);
    });
  }, 30_000);

  test('preFlightScan is scoped to the named branch', async () => {
    await withAdapter(async (adapter) => {
      const br1 = await adapter.createBranch('scan-a');
      const br2 = await adapter.createBranch('scan-b');

      await adapter.applyBranchChanges(br1.id, [
        { itemId: 'ffff0001-0000-0000-0000-000000000001', changeType: 'create', section: 'item', data: { value: 'a' } },
        { itemId: 'ffff0002-0000-0000-0000-000000000002', changeType: 'delete', section: 'item', data: null },
      ]);
      await adapter.applyBranchChanges(br2.id, [
        { itemId: 'ffff0003-0000-0000-0000-000000000003', changeType: 'update', section: 'item', data: { value: 'b' } },
      ]);

      const scan1 = await adapter.preFlightScan(br1.id);
      expect(scan1.summary.adds).toBe(1);
      expect(scan1.summary.deletes).toBe(1);
      expect(scan1.summary.edits).toBe(0);

      const scan2 = await adapter.preFlightScan(br2.id);
      expect(scan2.summary.adds).toBe(0);
      expect(scan2.summary.deletes).toBe(0);
      expect(scan2.summary.edits).toBe(1);
    });
  }, 30_000);
});

// ─── previewMerge / conflict-aware mergeBranch ────────────────────────────────
// The postgres twin of the sqlite-fs conflict matrix (spec «Conflict-aware
// merge»): classification runs against CURRENT main using the fork watermark
// (branches.branch_point_at). Tests pin the watermark explicitly so timing can
// never make them flake.

describe('previewMerge / conflict-aware mergeBranch', () => {
  const past   = (ms) => new Date(Date.now() - ms).toISOString();
  const future = (ms) => new Date(Date.now() + ms).toISOString();

  test('createBranch records branchPointAt (defaults to now, accepts override, rejects non-main base)', async () => {
    await withAdapter(async (adapter) => {
      const a = await adapter.createBranch('wm-default');
      expect(a.branchPointAt).toBeTruthy();
      expect(Math.abs(new Date(a.branchPointAt).getTime() - Date.now())).toBeLessThan(60_000);

      const point = past(3_600_000);
      const b = await adapter.createBranch('wm-explicit', { branchPointAt: point });
      expect(b.branchPointAt).toBe(point);
      const fetched = await adapter.getBranch('wm-explicit');
      expect(fetched.branchPointAt).toBe(point);

      await expect(adapter.createBranch('wm-base', { base: 'other' })).rejects.toThrow(/main/);
      await expect(adapter.createBranch('wm-bad', { branchPointAt: 'not-a-date' })).rejects.toThrow(/ISO-8601/);
    });
  }, 30_000);

  test('clean edit — main untouched since fork — no conflict, merge applies', async () => {
    await withAdapter(async (adapter, pool) => {
      const item = await createItem(adapter, { value: 'original', parentId: ROOT_ID });
      // Fork "after" the item's last modification → clean.
      const br = await adapter.createBranch('clean-edit', { branchPointAt: future(60_000) });
      await adapter.applyBranchChanges(br.id, [
        { itemId: item.id, changeType: 'update', section: 'item', data: { value: 'edited' } },
      ]);

      const preview = await adapter.previewMerge(br.id);
      expect(preview.edits).toHaveLength(1);
      expect(preview.edits[0].before.value).toBe('original');
      expect(preview.edits[0].after.value).toBe('edited');
      expect(preview.conflicts).toHaveLength(0);
      expect(preview.watermark).toBe((await adapter.getBranch('clean-edit')).branchPointAt);

      const result = await adapter.mergeBranch(br.id);
      expect(result.merged).toBe(1);
      expect(result.skipped).toBe(0);
      const { rows } = await pool.query('SELECT value FROM items WHERE id = $1', [item.id]);
      expect(rows[0].value).toBe('edited');
    });
  }, 30_000);

  test('edit-edit conflict — default merge ABORTS with MERGE_CONFLICT, nothing applied', async () => {
    await withAdapter(async (adapter, pool) => {
      const item = await createItem(adapter, { value: 'main-v1', parentId: ROOT_ID });
      // Fork BEFORE the item's modification → main moved after the fork.
      const br = await adapter.createBranch('ee-conflict', { branchPointAt: past(3_600_000) });
      await adapter.applyBranchChanges(br.id, [
        { itemId: item.id, changeType: 'update', section: 'item', data: { value: 'branch-v2' } },
      ]);

      const preview = await adapter.previewMerge('ee-conflict'); // by NAME
      expect(preview.conflicts).toHaveLength(1);
      expect(preview.conflicts[0].kind).toBe('edit-edit');
      expect(preview.conflicts[0].id).toBe(item.id);

      await expect(adapter.mergeBranch(br.id)).rejects.toMatchObject({ code: 'MERGE_CONFLICT' });
      // Nothing applied; branch preserved.
      const { rows } = await pool.query('SELECT value FROM items WHERE id = $1', [item.id]);
      expect(rows[0].value).toBe('main-v1');
      expect(await adapter.getBranchChanges(br.id)).toHaveLength(1);
      expect((await adapter.getBranch('ee-conflict')).mergedAt).toBeNull();
    });
  }, 30_000);

  test("strategy 'theirs' — branch wins the edit-edit conflict", async () => {
    await withAdapter(async (adapter, pool) => {
      const item = await createItem(adapter, { value: 'main-v1', parentId: ROOT_ID });
      const br = await adapter.createBranch('ee-theirs', { branchPointAt: past(3_600_000) });
      await adapter.applyBranchChanges(br.id, [
        { itemId: item.id, changeType: 'update', section: 'item', data: { value: 'branch-v2' } },
      ]);

      const result = await adapter.mergeBranch(br.id, { strategy: 'theirs' });
      expect(result.merged).toBe(1);
      expect(result.conflicts).toHaveLength(1);
      const { rows } = await pool.query('SELECT value FROM items WHERE id = $1', [item.id]);
      expect(rows[0].value).toBe('branch-v2');
    });
  }, 30_000);

  test("strategy 'ours' — main wins the conflicting item, clean changes still apply", async () => {
    await withAdapter(async (adapter, pool) => {
      const conflicted = await createItem(adapter, { value: 'keep-main', parentId: ROOT_ID });
      const br = await adapter.createBranch('ee-ours', { branchPointAt: past(3_600_000) });
      const cleanAddId = 'abcd0001-0000-0000-0000-000000000001';
      await adapter.applyBranchChanges(br.id, [
        { itemId: conflicted.id, changeType: 'update', section: 'item', data: { value: 'branch-loses' } },
        { itemId: cleanAddId, changeType: 'create', section: 'item',
          data: { value: 'clean-add', type: 'text', parentId: ROOT_ID, sortOrder: 0 } },
        { itemId: cleanAddId, changeType: 'create', section: 'meta',
          data: { specVersion: '1.4.0', createdBy: OWNER, visibility: 'private', tags: [], createdAt: new Date().toISOString() } },
      ]);

      const result = await adapter.mergeBranch(br.id, { strategy: 'ours' });
      expect(result.merged).toBe(1);
      expect(result.skipped).toBe(1);
      const { rows: keep } = await pool.query('SELECT value FROM items WHERE id = $1', [conflicted.id]);
      expect(keep[0].value).toBe('keep-main');
      const { rows: added } = await pool.query('SELECT value FROM items WHERE id = $1', [cleanAddId]);
      expect(added[0].value).toBe('clean-add');
    });
  }, 30_000);

  test('delete-edit conflict — staged delete of an item main modified after the fork', async () => {
    await withAdapter(async (adapter) => {
      const item = await createItem(adapter, { value: 'moved-on-main', parentId: ROOT_ID });
      const br = await adapter.createBranch('de-conflict', { branchPointAt: past(3_600_000) });
      await adapter.applyBranchChanges(br.id, [
        { itemId: item.id, changeType: 'delete', section: 'item', data: null },
      ]);

      const preview = await adapter.previewMerge(br.id);
      expect(preview.deletes).toHaveLength(1);
      expect(preview.conflicts).toHaveLength(1);
      expect(preview.conflicts[0].kind).toBe('delete-edit');
      await expect(adapter.mergeBranch(br.id)).rejects.toMatchObject({ code: 'MERGE_CONFLICT' });
    });
  }, 30_000);

  test("add-delete conflict — branch kept an item main deleted; 'theirs' resurrects it", async () => {
    await withAdapter(async (adapter, pool) => {
      const item = await createItem(adapter, { value: 'kept-on-branch', parentId: ROOT_ID });
      const br = await adapter.createBranch('ad-conflict', { branchPointAt: future(60_000) });
      // Branch edits the item (staged update carries the full doc, as SyncEngine pushes it)…
      await adapter.applyBranchChanges(br.id, [
        { itemId: item.id, changeType: 'update', section: 'item',
          data: { value: 'kept-and-edited', type: 'text', parentId: ROOT_ID, sortOrder: 0 } },
        { itemId: item.id, changeType: 'update', section: 'meta',
          data: { specVersion: '1.4.0', createdBy: OWNER, visibility: 'private', tags: [], createdAt: item.createdAt } },
      ]);
      // …then main deletes it after the fork.
      await pool.query('DELETE FROM items WHERE id = $1', [item.id]);

      const preview = await adapter.previewMerge(br.id);
      expect(preview.adds).toHaveLength(1); // the branch's kept version, absent on main
      expect(preview.conflicts).toHaveLength(1);
      expect(preview.conflicts[0].kind).toBe('add-delete');

      await expect(adapter.mergeBranch(br.id)).rejects.toMatchObject({ code: 'MERGE_CONFLICT' });

      const result = await adapter.mergeBranch(br.id, { strategy: 'theirs' });
      expect(result.merged).toBe(1);
      const { rows } = await pool.query('SELECT value FROM items WHERE id = $1', [item.id]);
      expect(rows).toHaveLength(1); // resurrected
      expect(rows[0].value).toBe('kept-and-edited');
    });
  }, 30_000);

  test('genuine add (created after fork) is never a conflict; no-op delete is dropped', async () => {
    await withAdapter(async (adapter) => {
      const br = await adapter.createBranch('genuine-add', { branchPointAt: past(3_600_000) });
      const addId  = 'abcd0002-0000-0000-0000-000000000002';
      const goneId = 'abcd0003-0000-0000-0000-000000000003'; // never existed on main
      await adapter.applyBranchChanges(br.id, [
        { itemId: addId, changeType: 'create', section: 'item',
          data: { value: 'new', type: 'text', parentId: ROOT_ID, sortOrder: 0 } },
        { itemId: addId, changeType: 'create', section: 'meta',
          data: { specVersion: '1.4.0', createdBy: OWNER, visibility: 'private', tags: [], createdAt: new Date().toISOString() } },
        { itemId: goneId, changeType: 'delete', section: 'item', data: null },
      ]);

      const preview = await adapter.previewMerge(br.id);
      expect(preview.adds).toHaveLength(1);
      expect(preview.deletes).toHaveLength(0); // already absent → no-op, not a delete
      expect(preview.conflicts).toHaveLength(0);
    });
  }, 30_000);

  test('blockOnBlastRadius aborts with MERGE_BLAST_RADIUS when a delete leaves live referrers', async () => {
    await withAdapter(async (adapter, pool) => {
      const parent = await createItem(adapter, { value: 'parent', parentId: ROOT_ID });
      const child  = await createItem(adapter, { value: 'child', parentId: parent.id });
      const br = await adapter.createBranch('blast-gate', { branchPointAt: future(60_000) });
      await adapter.applyBranchChanges(br.id, [
        { itemId: parent.id, changeType: 'delete', section: 'item', data: null },
      ]);

      const preview = await adapter.previewMerge(br.id);
      expect(preview.blastRadius).toHaveLength(1);
      expect(preview.blastRadius[0].id).toBe(parent.id);
      expect(preview.blastRadius[0].referencedBy.map(r => r.id)).toContain(child.id);
      expect(preview.blastRadius[0].referencedBy[0].via).toBe('parent');

      await expect(adapter.mergeBranch(br.id, { blockOnBlastRadius: true }))
        .rejects.toMatchObject({ code: 'MERGE_BLAST_RADIUS' });
      // Branch preserved for resolution.
      expect(await adapter.getBranchChanges(br.id)).toHaveLength(1);
    });
  }, 30_000);

  test('mergeBranchLocally is the facade-uniform alias (by name, same opts)', async () => {
    await withAdapter(async (adapter, pool) => {
      const item = await createItem(adapter, { value: 'v1', parentId: ROOT_ID });
      await adapter.createBranch('alias-merge', { branchPointAt: future(60_000) });
      const br = await adapter.getBranch('alias-merge');
      await adapter.applyBranchChanges(br.id, [
        { itemId: item.id, changeType: 'update', section: 'item', data: { value: 'v2' } },
      ]);
      const result = await adapter.mergeBranchLocally('alias-merge');
      expect(result.merged).toBe(1);
      const { rows } = await pool.query('SELECT value FROM items WHERE id = $1', [item.id]);
      expect(rows[0].value).toBe('v2');
    });
  }, 30_000);
});
