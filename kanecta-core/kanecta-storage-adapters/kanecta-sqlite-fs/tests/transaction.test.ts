'use strict';

// Universal transaction(fn) — the sqlite-fs counterpart of the Postgres
// adapter's atomic multi-op transactions: every write inside fn commits
// together or rolls back together (item.json pre-images + one db transaction).

import fs from 'fs';
import path from 'path';
import os from 'os';
import { SqliteFsAdapter } from '../src/adapter';

function tmpAdapter() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'kanecta-tx-'));
  return SqliteFsAdapter.init(root, 'test@example.com');
}
function cleanup(a: any) { fs.rmSync(a.root, { recursive: true, force: true }); }

describe('transaction(fn)', () => {
  let a: any;
  beforeEach(() => { a = tmpAdapter(); });
  afterEach(() => cleanup(a));

  test('multi-op commit: all writes land together and the result propagates', () => {
    const before = a.create({ value: 'pre-existing' });
    const out = a.transaction((tx: any) => {
      const x = tx.create({ value: 'tx-one' });
      const y = tx.create({ value: 'tx-two', parentId: x.id });
      tx.update(before.id, { value: 'pre-existing UPDATED' });
      return { x: x.id, y: y.id };
    });
    expect(a.get(out.x).value).toBe('tx-one');
    expect(a.get(out.y).parentId).toBe(out.x);
    expect(a.get(before.id).value).toBe('pre-existing UPDATED');
    // journal + lock resolved
    expect(fs.existsSync(path.join(a._branchRoot(), 'write.journal'))).toBe(false);
    expect(fs.existsSync(path.join(a._branchRoot(), 'write.lock'))).toBe(false);
  });

  test('rollback: a throw undoes every write — created items vanish, updates restore', () => {
    const keep = a.create({ value: 'original' });
    let createdId: any = null;
    expect(() => a.transaction((tx: any) => {
      const fresh = tx.create({ value: 'doomed' });
      createdId = fresh.id;
      tx.update(keep.id, { value: 'mutated' });
      throw new Error('abort!');
    })).toThrow('abort!');

    // created item: gone from fs, index, and query surface
    expect(a.get(createdId)).toBeNull();
    expect(fs.existsSync(a._itemDir(createdId))).toBe(false);
    expect(a.query({ limit: 100 }).some((i: any) => i.id === createdId)).toBe(false);
    // updated item: restored to its pre-image
    expect(a.get(keep.id).value).toBe('original');
    // journal + lock resolved; the store accepts new writes
    expect(fs.existsSync(path.join(a._branchRoot(), 'write.journal'))).toBe(false);
    expect(fs.existsSync(path.join(a._branchRoot(), 'write.lock'))).toBe(false);
    expect(a.create({ value: 'post-rollback write works' }).id).toBeTruthy();
  });

  test('rollback restores a deleted item', () => {
    const victim = a.create({ value: 'to-delete' });
    expect(() => a.transaction((tx: any) => {
      tx.delete(victim.id);
      throw new Error('abort!');
    })).toThrow('abort!');
    expect(a.get(victim.id)?.value).toBe('to-delete');
  });

  test('nested transaction() flattens into the outer one', () => {
    const keep = a.create({ value: 'v0' });
    expect(() => a.transaction((tx: any) => {
      tx.update(keep.id, { value: 'v1' });
      tx.transaction((inner: any) => inner.update(keep.id, { value: 'v2' }));
      throw new Error('abort!');
    })).toThrow('abort!');
    // the inner tx's write rolled back with the outer — one atom
    expect(a.get(keep.id).value).toBe('v0');
  });

  test('an async fn is rejected BEFORE running — no writes, no post-rollback leaks', async () => {
    const keep = a.create({ value: 'sync-only' });
    expect(() => a.transaction(async (tx: any) => {
      tx.update(keep.id, { value: 'should not survive' });
      tx.create({ value: 'leak-1' });
      await Promise.resolve();
      tx.create({ value: 'leak-2' });   // would apply OUTSIDE the tx if fn ever ran
    })).toThrow(/synchronous/);
    await new Promise((r) => setTimeout(r, 10)); // let any leaked continuation drain
    expect(a.get(keep.id).value).toBe('sync-only');
    const values = a.query({ limit: 100 }).map((i: any) => i.value);
    expect(values).not.toContain('leak-1');
    expect(values).not.toContain('leak-2');
  });

  test('first-touch pre-image wins: multiple updates to one item roll back to the ORIGINAL', () => {
    const keep = a.create({ value: 'first' });
    expect(() => a.transaction((tx: any) => {
      tx.update(keep.id, { value: 'second' });
      tx.update(keep.id, { value: 'third' });
      throw new Error('abort!');
    })).toThrow('abort!');
    expect(a.get(keep.id).value).toBe('first');
  });
});
