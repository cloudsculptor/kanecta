import os from 'os';
import path from 'path';
import fs from 'fs';
import request from 'supertest';
import { Datastore } from '@kanecta/lib';
import app from '../src/app.ts';
import { useConfig, clearConfigEnv } from './helpers.ts';

let tmpRoot: string;
let ds: any;

beforeEach(() => {
  tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'kanecta-api-projections-'));
  ds = Datastore.init(tmpRoot, 'test@example.com');
  useConfig(tmpRoot);
  process.env.AUTH_DISABLED = 'true';
  process.env.XDG_CONFIG_HOME = tmpRoot;
});

afterEach(() => {
  fs.rmSync(tmpRoot, { recursive: true, force: true });
  clearConfigEnv();
  delete process.env.AUTH_DISABLED;
  delete process.env.XDG_CONFIG_HOME;
});

describe('GET /projections', () => {
  it('lists the materialised per-type relations', async () => {
    const res = await request(app).get('/projections');
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.tables)).toBe(true);
    // A fresh store seeds built-in items, so at least one obj_ table exists.
    expect(res.body.tables.length).toBeGreaterThan(0);
    expect(res.body.tables.every((t: string) => t.startsWith('obj_'))).toBe(true);
  });
});

describe('POST /projections/rebuild', () => {
  it('rebuilds and returns the per-structure report', async () => {
    await ds.create({ value: 'hi', type: 'string' });
    const res = await request(app).post('/projections/rebuild');
    expect(res.status).toBe(200);
    expect(res.body.storage).toBe('filesystem');
    expect(res.body.ok).toBe(true);
    expect(res.body.items).toBeGreaterThan(0);
    const names = res.body.structures.map((s: any) => s.name);
    expect(names).toContain('obj-tables');
    expect(names).toContain('perf_backlinks');
  });

  it('accepts an `only` filter in the body', async () => {
    const res = await request(app)
      .post('/projections/rebuild')
      .send({ only: ['perf_search'] });
    expect(res.status).toBe(200);
    expect(res.body.structures.map((s: any) => s.name)).toEqual(['perf_search']);
  });

  it('accepts an `only` filter as a CSV query param', async () => {
    const res = await request(app)
      .post('/projections/rebuild')
      .query({ only: 'obj-tables,perf_backlinks' });
    expect(res.status).toBe(200);
    expect(res.body.structures.map((s: any) => s.name).sort())
      .toEqual(['obj-tables', 'perf_backlinks'].sort());
  });
});
