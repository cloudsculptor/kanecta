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
  tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'kanecta-api-integrity-'));
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

describe('GET /integrity', () => {
  it('returns a full report with checks and a summary', async () => {
    await ds.create({ value: 'hi', type: 'string' });
    const res = await request(app).get('/integrity');
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.checks)).toBe(true);
    expect(res.body.checks.length).toBeGreaterThan(0);
    expect(res.body.summary).toMatchObject({ total: res.body.checks.length });
    expect(res.body.summary.ok).toBe(true);
  });

  it('reports failures for a corrupted datastore', async () => {
    await ds.create({ value: 'orphan', type: 'object', typeId: 'deadbeef-0000-4000-8000-000000000000' });
    const res = await request(app).get('/integrity').query({ checks: 'typeid-resolves' });
    expect(res.status).toBe(200);
    expect(res.body.checks).toHaveLength(1);
    expect(res.body.checks[0].id).toBe('typeid-resolves');
    expect(res.body.checks[0].status).toBe('fail');
    expect(res.body.summary.ok).toBe(false);
  });

  it('filters by group', async () => {
    const res = await request(app).get('/integrity').query({ groups: 'references' });
    expect(res.status).toBe(200);
    expect(res.body.checks.every((c: any) => c.group === 'references')).toBe(true);
  });
});

describe('GET /integrity/stream', () => {
  it('streams SSE manifest, results, and done events', async () => {
    await ds.create({ value: 'hi', type: 'string' });
    const res = await request(app).get('/integrity/stream');
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/text\/event-stream/);

    const events = res.text
      .split('\n\n')
      .map((chunk) => chunk.replace(/^data: /, '').trim())
      .filter(Boolean)
      .map((json) => JSON.parse(json));

    expect(events[0].type).toBe('manifest');
    expect(events.some((e) => e.type === 'result')).toBe(true);
    expect(events[events.length - 1].type).toBe('done');
    expect(events[events.length - 1].summary.total).toBe(events[0].total);
  });
});
