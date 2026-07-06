'use strict';

// Idempotent external-ingestion primitives: create() accepting a source key and
// bySource() looking one up. These back deterministic importers (e.g. the Claude
// transcript importer) whose upsert is: bySource() ? update() : create().

import os from 'os';
import path from 'path';
import fs from 'fs';

import { SqliteFsAdapter } from '../src/adapter';

let tmp;
let ds;

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'kanecta-source-'));
  ds  = SqliteFsAdapter.init(tmp, 'test@example.com');
});

afterEach(() => {
  try { fs.rmSync(tmp, { recursive: true, force: true }); } catch {}
});

describe('create() with a source key', () => {
  it('persists sourceSystem / sourceExternalId', () => {
    const item = ds.create({
      value: 'imported', type: 'note',
      sourceSystem: 'claude-code', sourceExternalId: 'evt-1',
    });
    expect(item.sourceSystem).toBe('claude-code');
    expect(item.sourceExternalId).toBe('evt-1');

    const reloaded = ds.get(item.id);
    expect(reloaded.sourceSystem).toBe('claude-code');
    expect(reloaded.sourceExternalId).toBe('evt-1');
  });

  it('defaults the source fields to null', () => {
    const item = ds.create({ value: 'plain', type: 'note' });
    expect(item.sourceSystem).toBeNull();
    expect(item.sourceExternalId).toBeNull();
  });

  // The meta write is INSERT OR REPLACE keyed on item_id, so a second create()
  // under the same source key does NOT throw — it steals the key and orphans the
  // prior item's meta row. Callers must therefore never double-create: the
  // idempotent contract is bySource() ? update() : create() (see below).
  it('does not throw on a duplicate source key (why callers must upsert)', () => {
    const first = ds.create({ value: 'first', type: 'note', sourceSystem: 'sys', sourceExternalId: 'dup' });
    ds.create({ value: 'second', type: 'note', sourceSystem: 'sys', sourceExternalId: 'dup' });
    // The key now resolves to the second item, not the first — hence upsert.
    expect(ds.bySource('sys', 'dup').value).toBe('second');
    expect(first.value).toBe('first');
  });

  it('allows the same externalId under a different sourceSystem', () => {
    const a = ds.create({ value: 'a', type: 'note', sourceSystem: 'sysA', sourceExternalId: 'x' });
    const b = ds.create({ value: 'b', type: 'note', sourceSystem: 'sysB', sourceExternalId: 'x' });
    expect(a.id).not.toBe(b.id);
  });
});

describe('bySource()', () => {
  it('returns the item for a known key', () => {
    const created = ds.create({
      value: 'imported', type: 'note',
      sourceSystem: 'claude-code', sourceExternalId: 'session-42',
    });
    const found = ds.bySource('claude-code', 'session-42');
    expect(found).not.toBeNull();
    expect(found.id).toBe(created.id);
    expect(found.value).toBe('imported');
  });

  it('returns null for an unknown key', () => {
    expect(ds.bySource('claude-code', 'nope')).toBeNull();
  });

  it('returns null when either argument is missing', () => {
    expect(ds.bySource('claude-code', null)).toBeNull();
    expect(ds.bySource(null, 'x')).toBeNull();
  });

  it('reflects a source key set later via update()', () => {
    const item = ds.create({ value: 'v', type: 'note' });
    expect(ds.bySource('sys', 'later')).toBeNull();
    ds.update(item.id, { sourceSystem: 'sys', sourceExternalId: 'later' });
    const found = ds.bySource('sys', 'later');
    expect(found?.id).toBe(item.id);
  });

  it('supports the upsert pattern (create then re-find and update)', () => {
    const key = { sourceSystem: 'claude-code', sourceExternalId: 'turn-7' };
    // First pass: not present → create.
    expect(ds.bySource(key.sourceSystem, key.sourceExternalId)).toBeNull();
    const created = ds.create({ value: 'v1', type: 'note', ...key });
    // Second pass: present → update in place, same id.
    const existing = ds.bySource(key.sourceSystem, key.sourceExternalId);
    expect(existing.id).toBe(created.id);
    ds.update(existing.id, { value: 'v2' });
    expect(ds.get(created.id).value).toBe('v2');
    // Still exactly one item under that key.
    expect(ds.bySource(key.sourceSystem, key.sourceExternalId).id).toBe(created.id);
  });
});
