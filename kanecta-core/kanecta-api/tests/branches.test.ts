/**
 * Tests for the working-set branch diff/merge endpoints:
 *  - GET  /working-sets/:name/branches/:branch/diff
 *  - POST /working-sets/:name/branches/:branch/merge
 *
 * These back the Studio WorkingSetSelector's live change stats and the
 * "Create Pull Request" (local merge into main) action.
 */

import os from 'os';
import path from 'path';
import fs from 'fs';
import request from 'supertest';
import { Datastore } from '@kanecta/lib';
import app from '../src/app.ts';
import { useConfig, clearConfigEnv } from './helpers.ts';

let tmpRoot;
let ds;

beforeEach(() => {
  tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'kanecta-api-branches-test-'));
  ds = Datastore.init(tmpRoot, 'test@example.com');
  useConfig(tmpRoot); // working set "default" → tmpRoot
  process.env.AUTH_DISABLED = 'true';
});

afterEach(() => {
  fs.rmSync(tmpRoot, { recursive: true, force: true });
  clearConfigEnv();
  delete process.env.AUTH_DISABLED;
});

describe('GET /working-sets/:name/branches/:branch/diff', () => {
  it('reports zero changes for main', async () => {
    const res = await request(app).get('/working-sets/default/branches/main/diff');
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ branch: 'main', adds: 0, edits: 0, deletes: 0 });
  });

  it('counts a sparse branch\'s local additions', async () => {
    ds.createBranch('feature/x', { fill: 'sparse', upstream: { branch: 'main' } });
    ds.useBranch('feature/x');
    await ds.create({ type: 'string', value: 'only-on-branch' });

    const res = await request(app).get('/working-sets/default/branches/feature%2Fx/diff');
    expect(res.status).toBe(200);
    expect(res.body.branch).toBe('feature/x');
    expect(res.body.adds).toBe(1);
    expect(res.body.edits).toBe(0);
    expect(res.body.deletes).toBe(0);
  });

  it('returns the item-level review payload (the "PR diff"), not just counts', async () => {
    const item = await ds.create({ type: 'string', value: 'v0' });
    ds.createBranch('feature/detail', { fill: 'sparse', upstream: { branch: 'main' } });
    ds.useBranch('feature/detail');
    await ds.update(item.id, { value: 'v1 on branch' }, 'test@example.com');
    const added = await ds.create({ type: 'string', value: 'brand new' });

    const res = await request(app).get('/working-sets/default/branches/feature%2Fdetail/diff');
    expect(res.status).toBe(200);
    // counts stay backward-compatible…
    expect(res.body).toMatchObject({ adds: 1, edits: 1, deletes: 0 });
    // …and detail carries per-item before/after for review
    expect(res.body.detail.adds).toHaveLength(1);
    expect(res.body.detail.adds[0]).toMatchObject({ id: added.id });
    expect(res.body.detail.adds[0].after.value).toBe('brand new');
    expect(res.body.detail.edits).toHaveLength(1);
    expect(res.body.detail.edits[0].id).toBe(item.id);
    expect(res.body.detail.edits[0].before.value).toBe('v0');
    expect(res.body.detail.edits[0].after.value).toBe('v1 on branch');
    // the adapter's internal doc is not leaked
    expect(res.body.detail.adds[0].doc).toBeUndefined();
    expect(res.body.detail.edits[0].doc).toBeUndefined();
  });

  it('merge-preview carries the same detail payload alongside conflicts/blastRadius', async () => {
    ds.createBranch('feature/pv', { fill: 'sparse', upstream: { branch: 'main' } });
    ds.useBranch('feature/pv');
    const added = await ds.create({ type: 'string', value: 'preview me' });

    const res = await request(app).get('/working-sets/default/branches/feature%2Fpv/merge-preview');
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ adds: 1, conflicts: [], blastRadius: [] });
    expect(res.body.detail.adds[0]).toMatchObject({ id: added.id });
    expect(res.body.detail.adds[0].after.value).toBe('preview me');
  });

  it('404s for an unknown working set', async () => {
    const res = await request(app).get('/working-sets/nope/branches/main/diff');
    expect(res.status).toBe(404);
  });
});

describe('POST /working-sets/:name/branches/:branch/merge', () => {
  it('applies the branch changes to main and removes the branch', async () => {
    ds.createBranch('feature/y', { fill: 'sparse', upstream: { branch: 'main' } });
    ds.useBranch('feature/y');
    const item = await ds.create({ type: 'string', value: 'merge-me' });

    const res = await request(app).post('/working-sets/default/branches/feature%2Fy/merge');
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.merged).toBe(1);

    // The item now lives on main, and the branch folder is gone.
    const main = Datastore.open(tmpRoot);
    main.useBranch('main');
    expect(await main.get(item.id)).toMatchObject({ id: item.id, value: 'merge-me' });
    expect(main.listBranches().map((b) => b.name)).not.toContain('feature/y');
  });

  it('refuses to merge main into itself', async () => {
    const res = await request(app).post('/working-sets/default/branches/main/merge');
    expect(res.status).toBe(400);
  });

  it('reports a conflict (409) when upstream moved after the fork, and resolves with a strategy', async () => {
    const item = await ds.create({ type: 'string', value: 'v0' });
    ds.createBranch('feature/c', { fill: 'sparse', upstream: { branch: 'main' } });
    ds.useBranch('feature/c');
    await ds.update(item.id, { value: 'branch edit' }, 'test@example.com');

    ds.useBranch('main');
    await new Promise((r) => setTimeout(r, 5)); // main edit must land after the branch point
    await ds.update(item.id, { value: 'main edit' }, 'other@example.com');

    // Preview flags the conflict without applying anything.
    const prev = await request(app).get('/working-sets/default/branches/feature%2Fc/merge-preview');
    expect(prev.status).toBe(200);
    expect(prev.body.conflicts.map((c) => c.id)).toContain(item.id);

    // Default merge is refused.
    const res = await request(app).post('/working-sets/default/branches/feature%2Fc/merge');
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('MERGE_CONFLICT');
    expect(res.body.conflicts.map((c) => c.id)).toContain(item.id);

    // A strategy resolves it.
    const forced = await request(app)
      .post('/working-sets/default/branches/feature%2Fc/merge')
      .send({ strategy: 'theirs' });
    expect(forced.status).toBe(200);
    expect(forced.body.merged).toBe(1);
  });

  it('surfaces blast radius and blocks on it when requested', async () => {
    const parent = await ds.create({ type: 'string', value: 'parent' });
    const child = await ds.create({ type: 'string', value: 'child', parentId: parent.id });
    ds.createBranch('feature/d', { fill: 'sparse', upstream: { branch: 'main' } });
    ds.useBranch('feature/d');
    await ds.delete(parent.id, 'test@example.com');

    const prev = await request(app).get('/working-sets/default/branches/feature%2Fd/merge-preview');
    expect(prev.status).toBe(200);
    const hit = prev.body.blastRadius.find((b) => b.id === parent.id);
    expect(hit).toBeTruthy();
    expect(hit.referencedBy.some((r) => r.id === child.id && r.via === 'parent')).toBe(true);

    // blockOnBlastRadius refuses the merge.
    const blocked = await request(app)
      .post('/working-sets/default/branches/feature%2Fd/merge')
      .send({ blockOnBlastRadius: true });
    expect(blocked.status).toBe(409);
    expect(blocked.body.code).toBe('MERGE_BLAST_RADIUS');
  });
});
