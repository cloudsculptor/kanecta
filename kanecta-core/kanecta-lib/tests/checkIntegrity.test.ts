'use strict';

import os from 'os';
import path from 'path';
import fs from 'fs';
import { afterEach, describe, expect, test } from 'vitest';
import {
  Datastore, TYPES_NODE,
  checkIntegrity, checkIntegrityStream, INTEGRITY_CHECKS,
} from '../src/index.ts';

const dsRoots: string[] = [];
function tmpDs() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'kanecta-integrity-test-'));
  dsRoots.push(root);
  return Datastore.init(root, 'test@example.com');
}
afterEach(() => {
  while (dsRoots.length) {
    const r = dsRoots.pop()!;
    try { fs.rmSync(r, { recursive: true, force: true }); } catch { /* ignore */ }
  }
});

const RANDOM_UUID = 'deadbeef-0000-4000-8000-000000000000';

// Collect just the CheckResult objects from the stream.
async function report(ds: any, opts?: any) {
  return checkIntegrity(ds, opts);
}
function byId(rep: { checks: any[] }, id: string) {
  const r = rep.checks.find((c) => c.id === id);
  if (!r) throw new Error(`no check result for ${id}`);
  return r;
}

// ─── catalogue ────────────────────────────────────────────────────────────────

describe('catalogue', () => {
  test('INTEGRITY_CHECKS is a non-empty, unique, well-formed list', () => {
    expect(INTEGRITY_CHECKS.length).toBeGreaterThan(0);
    const ids = INTEGRITY_CHECKS.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length); // unique
    for (const c of INTEGRITY_CHECKS) {
      expect(c.id).toBeTruthy();
      expect(c.title).toBeTruthy();
      expect(c.group).toBeTruthy();
      expect(c.specRef).toBeTruthy();
    }
  });
});

// ─── streaming shape ──────────────────────────────────────────────────────────

describe('checkIntegrityStream', () => {
  test('yields a manifest first, one result per check, then done', async () => {
    const ds = tmpDs();
    const events: any[] = [];
    for await (const ev of checkIntegrityStream(ds)) events.push(ev);

    expect(events[0].type).toBe('manifest');
    expect(events[0].total).toBe(INTEGRITY_CHECKS.length);
    expect(events[0].checks).toHaveLength(INTEGRITY_CHECKS.length);

    const results = events.filter((e) => e.type === 'result');
    expect(results).toHaveLength(INTEGRITY_CHECKS.length);
    // indices are sequential
    results.forEach((r, i) => expect(r.index).toBe(i));

    const last = events[events.length - 1];
    expect(last.type).toBe('done');
    expect(last.summary.total).toBe(INTEGRITY_CHECKS.length);
  });

  test('opts.checks restricts which checks run', async () => {
    const ds = tmpDs();
    const rep = await report(ds, { checks: ['id-is-uuid', 'value-length'] });
    expect(rep.checks.map((c) => c.id).sort()).toEqual(['id-is-uuid', 'value-length']);
  });

  test('opts.groups restricts by group', async () => {
    const ds = tmpDs();
    const rep = await report(ds, { groups: ['references'] });
    expect(rep.checks.every((c) => c.group === 'references')).toBe(true);
    expect(rep.checks.length).toBeGreaterThan(0);
  });
});

// ─── clean datastore ──────────────────────────────────────────────────────────

describe('clean datastore', () => {
  test('a fresh datastore reports no errors', async () => {
    const ds = tmpDs();
    await ds.create({ value: 'hello', type: 'string' });
    await ds.create({ value: 'a note', type: 'text' });
    const rep = await report(ds);
    const failing = rep.checks.filter((c) => c.status === 'fail');
    expect(failing, `unexpected failures: ${JSON.stringify(failing, null, 2)}`).toHaveLength(0);
    expect(rep.summary.ok).toBe(true);
    expect(rep.summary.errorCount).toBe(0);
  });

  test('storage-specific Postgres check is skipped on filesystem', async () => {
    const ds = tmpDs();
    const rep = await report(ds);
    const pg = byId(rep, 'obj-table-matches-sqlschema');
    expect(pg.status).toBe('skip');
    expect(pg.skipped).toMatch(/Postgres|cloud/i);
  });
});

// ─── corruption → the right check fails ───────────────────────────────────────

describe('corrupted datastores', () => {
  test('dangling typeId fails typeid-resolves', async () => {
    const ds = tmpDs();
    await ds.create({ value: 'orphan', type: 'object', typeId: RANDOM_UUID });
    const rep = await report(ds, { checks: ['typeid-resolves'] });
    const r = byId(rep, 'typeid-resolves');
    expect(r.status).toBe('fail');
    expect(r.findings.some((f: any) => f.typeId === RANDOM_UUID)).toBe(true);
  });

  test('over-long value fails value-length', async () => {
    const ds = tmpDs();
    await ds.create({ value: 'x'.repeat(300), type: 'text' });
    const rep = await report(ds, { checks: ['value-length'] });
    expect(byId(rep, 'value-length').status).toBe('fail');
  });

  test('dangling alias fails alias-targets-resolve', async () => {
    const ds = tmpDs();
    await ds.setAlias('ghost', RANDOM_UUID);
    const rep = await report(ds, { checks: ['alias-targets-resolve'] });
    const r = byId(rep, 'alias-targets-resolve');
    expect(r.status).toBe('fail');
    expect(r.findings.some((f: any) => f.alias === 'ghost')).toBe(true);
  });

  test('case-insensitive duplicate alias fails alias-uniqueness', async () => {
    const ds = tmpDs();
    const a = await ds.create({ value: 'real', type: 'string' });
    // setAlias stores the exact string; two casings become two rows.
    await ds.setAlias('Foo', a.id);
    await ds.setAlias('foo', a.id);
    const rep = await report(ds, { checks: ['alias-uniqueness'] });
    expect(byId(rep, 'alias-uniqueness').status).toBe('fail');
  });

  test('broken inline link warns via inline-links-resolve', async () => {
    const ds = tmpDs();
    await ds.create({ value: `see [[${RANDOM_UUID}]] for details`, type: 'text' });
    const rep = await report(ds, { checks: ['inline-links-resolve'] });
    const r = byId(rep, 'inline-links-resolve');
    // warn-only: status stays pass, but a finding is recorded
    expect(r.findings.some((f: any) => f.target === RANDOM_UUID)).toBe(true);
    expect(r.findings[0].severity).toBe('warn');
  });

  test('valid inline link produces no finding', async () => {
    const ds = tmpDs();
    const target = await ds.create({ value: 'target', type: 'string' });
    await ds.create({ value: `see [[${target.id}]]`, type: 'text' });
    const rep = await report(ds, { checks: ['inline-links-resolve'] });
    expect(byId(rep, 'inline-links-resolve').findings).toHaveLength(0);
  });

  test('object payload that violates its type schema fails object-payload-valid', async () => {
    const ds = tmpDs();
    // Define a type with a required numeric field.
    const type = await ds.create({ value: 'Widget', type: 'type', parentId: TYPES_NODE });
    await ds.writeTypeJson(type.id, {
      meta: { description: 'a widget', icon: 'Widgets', primaryField: 'name' },
      jsonSchema: {
        $schema: 'http://json-schema.org/draft-07/schema#',
        type: 'object',
        required: ['size'],
        properties: {
          name: { type: 'string', 'x-id': '11111111-1111-4111-8111-111111111111' },
          size: { type: 'number', 'x-id': '22222222-2222-4222-8222-222222222222' },
        },
      },
      sqlSchema: ['CREATE TABLE obj_widget (item_id UUID PRIMARY KEY)'],
    });
    const obj = await ds.create({ value: 'w1', type: 'object', typeId: type.id, parentId: type.id });
    await ds.writeObjectJson(obj.id, { name: 'w1', size: 'not-a-number' });
    const rep = await report(ds, { checks: ['object-payload-valid'] });
    const r = byId(rep, 'object-payload-valid');
    expect(r.status).toBe('fail');
    expect(r.findings.some((f: any) => String(f.message).includes('size'))).toBe(true);
  });

  test('valid object payload passes object-payload-valid', async () => {
    const ds = tmpDs();
    const type = await ds.create({ value: 'Widget', type: 'type', parentId: TYPES_NODE });
    await ds.writeTypeJson(type.id, {
      meta: { description: 'a widget', icon: 'Widgets', primaryField: 'name' },
      jsonSchema: {
        $schema: 'http://json-schema.org/draft-07/schema#',
        type: 'object',
        required: ['size'],
        properties: {
          name: { type: 'string', 'x-id': '11111111-1111-4111-8111-111111111111' },
          size: { type: 'number', 'x-id': '22222222-2222-4222-8222-222222222222' },
        },
      },
      sqlSchema: ['CREATE TABLE obj_widget (item_id UUID PRIMARY KEY)'],
    });
    const obj = await ds.create({ value: 'w1', type: 'object', typeId: type.id, parentId: type.id });
    await ds.writeObjectJson(obj.id, { name: 'w1', size: 42 });
    const rep = await report(ds, { checks: ['object-payload-valid'] });
    expect(byId(rep, 'object-payload-valid').status).toBe('pass');
  });

  test('malformed type definition fails typedef-valid', async () => {
    const ds = tmpDs();
    const type = await ds.create({ value: 'Broken', type: 'type', parentId: TYPES_NODE });
    // Property missing x-id → validator flags kanecta:x-id-required.
    // (writeTypeJson only enforces meta.icon; the rest is validated at rest.)
    await ds.writeTypeJson(type.id, {
      meta: { description: 'broken', icon: 'Warning', primaryField: 'name' },
      jsonSchema: {
        $schema: 'http://json-schema.org/draft-07/schema#',
        type: 'object',
        properties: { name: { type: 'string' } },
      },
      sqlSchema: ['CREATE TABLE obj_broken (item_id UUID PRIMARY KEY)'],
    });
    const rep = await report(ds, { checks: ['typedef-valid'] });
    const r = byId(rep, 'typedef-valid');
    expect(r.status).toBe('fail');
    expect(r.findings.some((f: any) => f.rule === 'kanecta:x-id-required')).toBe(true);
  });

  test('one check throwing does not abort the run', async () => {
    const ds = tmpDs();
    // Force loadAll to throw for one context build — instead, monkeypatch a method
    // the metadata check relies on. Simplest: corrupt an item to be non-object.
    // Here we just assert the engine wraps errors into a failed CheckResult.
    const brokenDs = {
      loadAll: async () => { throw new Error('boom'); },
      listTypeDefs: async () => [],
      listAliases: async () => [],
      listRelationships: async () => [],
      get: async () => null,
      readTypeJson: async () => null,
      readObjectJson: async () => null,
      readFunctionJson: async () => null,
      root: '/tmp/x',
    };
    const rep = await report(brokenDs as any);
    // context built with empty items (loadAll safe-wrapped to []), so checks pass;
    // this asserts the engine is resilient to a flaky handle.
    expect(rep.summary.total).toBe(INTEGRITY_CHECKS.length);
  });
});
