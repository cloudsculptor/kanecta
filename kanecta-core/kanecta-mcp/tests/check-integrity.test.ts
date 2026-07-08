/**
 * Tests for the kanecta_check_integrity MCP tool — it runs lib's spec-derived
 * integrity check and returns the collected { checks, summary } report.
 */

import os from 'os';
import path from 'path';
import fs from 'fs';
import { Datastore } from '@kanecta/lib';
import { vi } from 'vitest';
import { singleConfig, clearConfigEnv } from './helpers.ts';

const ORPHAN_TYPE_ID = 'deadbeef-0000-4000-8000-000000000000';

let tmpRoot: string;
let ds: any;
let dispatch: any;

beforeEach(async () => {
  vi.resetModules();
  tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'kanecta-mcp-integrity-'));
  ds = Datastore.init(tmpRoot, 'test@example.com');
  singleConfig(tmpRoot);
  ({ dispatch } = await import('../src/index.ts'));
});

afterEach(() => {
  fs.rmSync(tmpRoot, { recursive: true, force: true });
  clearConfigEnv();
  vi.restoreAllMocks();
});

describe('kanecta_check_integrity', () => {
  test('returns a report with checks and a summary (clean store)', async () => {
    await ds.create({ value: 'hi', type: 'string' });
    const res = await dispatch('kanecta_check_integrity', {});
    expect(Array.isArray(res.checks)).toBe(true);
    expect(res.checks.length).toBeGreaterThan(0);
    expect(res.summary.total).toBe(res.checks.length);
    expect(res.summary.ok).toBe(true);
  });

  test('flags a dangling typeId and reports ok:false', async () => {
    await ds.create({ type: 'object', typeId: ORPHAN_TYPE_ID, objectData: {} });
    const res = await dispatch('kanecta_check_integrity', { checks: ['typeid-resolves'] });
    expect(res.checks).toHaveLength(1);
    expect(res.checks[0].id).toBe('typeid-resolves');
    expect(res.checks[0].status).toBe('fail');
    expect(res.summary.ok).toBe(false);
  });

  test('restricts by group', async () => {
    const res = await dispatch('kanecta_check_integrity', { groups: ['references'] });
    expect(res.checks.every((c: any) => c.group === 'references')).toBe(true);
    expect(res.checks.length).toBeGreaterThan(0);
  });
});
