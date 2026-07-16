'use strict';

// Activity log (spec §activityPayload) — the second append-only exempt log:
// item_history tracks what CHANGED; activity tracks what HAPPENED.

import fs from 'fs';
import path from 'path';
import os from 'os';
import { SqliteFsAdapter } from '../src/adapter';

function tmpAdapter() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'kanecta-act-'));
  return SqliteFsAdapter.init(root, 'test@example.com');
}
function cleanup(a: any) { fs.rmSync(a.root, { recursive: true, force: true }); }

// This adapter's config defaults activity to 'NONE' (fs datastores are often
// VCS-backed); tests opt in by flipping the cached config.
function enableActivity(a: any) { a.config.activity = 'EXTERNAL'; }

describe('activity log', () => {
  let a: any;
  beforeEach(() => { a = tmpAdapter(); });
  afterEach(() => cleanup(a));

  test("gated off by default: recording is a no-op returning null (spec: 'NONE' → never written)", () => {
    expect(a.recordActivity({ eventType: 'item.viewed', actor: 'alice@acme.com' })).toBeNull();
    expect(a.listActivity()).toEqual([]);
  });

  test('records and reads workspace events, newest first', () => {
    enableActivity(a);
    const item = a.create({ value: 'watched' });
    const e1 = a.recordActivity({ eventType: 'item.viewed', actor: 'alice@acme.com', targetId: item.id });
    const e2 = a.recordActivity({
      eventType: 'search.performed', actor: 'alice@acme.com',
      data: { query: 'drill press maintenance', resultCount: 12 },
    });
    expect(e1).toMatchObject({ eventType: 'item.viewed', actor: 'alice@acme.com', targetId: item.id, data: null });
    expect(e1.id).toBeTruthy();
    expect(e1.occurredAt).toBeTruthy();
    // workspace-level event: null targetId, structured data round-trips
    expect(e2.targetId).toBeNull();
    expect(e2.data).toEqual({ query: 'drill press maintenance', resultCount: 12 });

    expect(a.activityFor(item.id).map((e: any) => e.id)).toEqual([e1.id]);
    expect(a.listActivity().map((e: any) => e.eventType)).toEqual(['search.performed', 'item.viewed']);
    expect(a.listActivity({ eventType: 'item.viewed' }).map((e: any) => e.id)).toEqual([e1.id]);
  });

  test('eventType and actor are required', () => {
    enableActivity(a);
    expect(() => a.recordActivity({ actor: 'alice@acme.com' })).toThrow(/eventType/);
    expect(() => a.recordActivity({ eventType: 'item.viewed' })).toThrow(/actor/);
  });

  test('events survive deletion of the target item (no FK; append-only)', () => {
    enableActivity(a);
    const item = a.create({ value: 'short-lived' });
    const e = a.recordActivity({ eventType: 'item.viewed', actor: 'bob@acme.com', targetId: item.id });
    a.delete(item.id);
    expect(a.activityFor(item.id).map((x: any) => x.id)).toEqual([e.id]);
  });
});
