'use strict';

/**
 * Tests for the working-set branch diff/merge endpoints:
 *  - GET  /working-sets/:name/branches/:branch/diff
 *  - POST /working-sets/:name/branches/:branch/merge
 *
 * These back the Studio WorkingSetSelector's live change stats and the
 * "Create Pull Request" (local merge into main) action.
 */

const os = require('os');
const path = require('path');
const fs = require('fs');
const request = require('supertest');
const { Datastore } = require('@kanecta/lib');
const app = require('../src/app');

let tmpRoot;
let ds;

beforeEach(() => {
  tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'kanecta-api-branches-test-'));
  ds = Datastore.init(tmpRoot, 'test@example.com');
  require('./helpers').useConfig(tmpRoot); // working set "default" → tmpRoot
  process.env.AUTH_DISABLED = 'true';
});

afterEach(() => {
  fs.rmSync(tmpRoot, { recursive: true, force: true });
  require('./helpers').clearConfigEnv();
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
});
