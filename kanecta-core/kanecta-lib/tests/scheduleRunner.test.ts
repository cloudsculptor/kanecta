'use strict';

import os from 'os';
import path from 'path';
import fs from 'fs';

import { SqliteFsAdapter } from '../../kanecta-storage-adapters/kanecta-sqlite-fs/src/adapter.ts';
import { ScheduleRunner } from '../src/scheduleRunner.ts';

// ─── Setup ─────────────────────────────────────────────────────────────────────

let tmp;
let adapter;

function freshAdapter() {
  tmp     = fs.mkdtempSync(path.join(os.tmpdir(), 'kanecta-sr-'));
  adapter = SqliteFsAdapter.init(tmp, 'test@example.com');
  return adapter;
}

beforeEach(() => freshAdapter());
afterEach(() => {
  try { fs.rmSync(tmp, { recursive: true, force: true }); } catch {}
});

// ─── Helpers ───────────────────────────────────────────────────────────────────

// Mock cron parser: always returns a fixed next fire time.
function mockNextFireAt(returnValue = '2026-06-28T02:00:00.000Z') {
  const calls = [];
  const fn = (expr, tz, after) => {
    calls.push({ expr, tz, after });
    return returnValue;
  };
  fn.calls = calls;
  return fn;
}

// Create a schedule item with the given payload.
function mkSchedule({
  value         = 'Test Schedule',
  status        = 'active',
  dueAt         = '2026-06-27T02:00:00.000Z',
  cronExpression = '0 2 * * *',
  timezone       = null,
  actionId       = 'aaaaaaaa-0000-0000-0000-000000000001',
  actionType     = 'function',
  targetItemId   = null,
  params         = null,
} = {}) {
  const item = adapter.create({ type: 'schedule', value, status, dueAt });
  adapter.writeScheduleJson(item.id, {
    cronExpression, timezone, actionId, actionType, targetItemId, params,
    lastFiredAt: null, lastResult: null, lastError: null,
  });
  return adapter.get(item.id);
}

function makeRunOp(impl) {
  const calls = [];
  const fn = async (opRef, params) => {
    calls.push({ opRef, params });
    return impl ? impl(opRef, params) : undefined;
  };
  fn.calls = calls;
  return fn;
}

// ─── Constructor ──────────────────────────────────────────────────────────────

describe('ScheduleRunner constructor', () => {
  it('accepts adapter and runOperation', () => {
    const runOp  = makeRunOp();
    const runner = new ScheduleRunner(adapter, runOp);
    expect(runner._adapter).toBe(adapter);
    expect(runner._runOp).toBe(runOp);
  });

  it('uses injected nextFireAt instead of default', () => {
    const nfa    = mockNextFireAt();
    const runner = new ScheduleRunner(adapter, makeRunOp(), { nextFireAt: nfa });
    expect(runner._nextFireAt).toBe(nfa);
  });
});

// ─── tick — basic ─────────────────────────────────────────────────────────────

describe('tick — basic', () => {
  it('returns { fired: 0, failed: 0 } when nothing is due', async () => {
    const runner = new ScheduleRunner(adapter, makeRunOp(), { nextFireAt: mockNextFireAt() });
    const result = await runner.tick('2020-01-01T00:00:00.000Z');
    expect(result).toEqual({ fired: 0, failed: 0 });
  });

  it('fires a due active schedule', async () => {
    const runOp  = makeRunOp();
    const runner = new ScheduleRunner(adapter, runOp, { nextFireAt: mockNextFireAt() });
    mkSchedule({ dueAt: '2026-06-27T01:00:00.000Z' });

    const result = await runner.tick('2026-06-27T02:00:00.000Z');
    expect(result).toEqual({ fired: 1, failed: 0 });
    expect(runOp.calls).toHaveLength(1);
  });

  it('does not fire a schedule that is not yet due', async () => {
    const runOp  = makeRunOp();
    const runner = new ScheduleRunner(adapter, runOp, { nextFireAt: mockNextFireAt() });
    mkSchedule({ dueAt: '2026-06-28T02:00:00.000Z' });

    const result = await runner.tick('2026-06-27T02:00:00.000Z');
    expect(result).toEqual({ fired: 0, failed: 0 });
    expect(runOp.calls).toHaveLength(0);
  });

  it('does not fire a paused schedule', async () => {
    const runOp  = makeRunOp();
    const runner = new ScheduleRunner(adapter, runOp, { nextFireAt: mockNextFireAt() });
    mkSchedule({ status: 'paused', dueAt: '2026-06-27T01:00:00.000Z' });

    const result = await runner.tick('2026-06-27T02:00:00.000Z');
    expect(result).toEqual({ fired: 0, failed: 0 });
  });

  it('does not fire a deleted schedule', async () => {
    const runOp  = makeRunOp();
    const runner = new ScheduleRunner(adapter, runOp, { nextFireAt: mockNextFireAt() });
    const item = mkSchedule({ dueAt: '2026-06-27T01:00:00.000Z' });
    adapter.delete(item.id);

    const result = await runner.tick('2026-06-27T02:00:00.000Z');
    expect(result).toEqual({ fired: 0, failed: 0 });
  });

  it('fires multiple due schedules', async () => {
    const runOp  = makeRunOp();
    const runner = new ScheduleRunner(adapter, runOp, { nextFireAt: mockNextFireAt() });
    mkSchedule({ dueAt: '2026-06-27T01:00:00.000Z', actionId: 'aaaaaaaa-0000-0000-0000-000000000001' });
    mkSchedule({ dueAt: '2026-06-27T01:30:00.000Z', actionId: 'aaaaaaaa-0000-0000-0000-000000000002' });

    const result = await runner.tick('2026-06-27T02:00:00.000Z');
    expect(result).toEqual({ fired: 2, failed: 0 });
    expect(runOp.calls).toHaveLength(2);
  });

  it('uses current time as default when now is not provided', async () => {
    const runOp  = makeRunOp();
    const runner = new ScheduleRunner(adapter, runOp, { nextFireAt: mockNextFireAt() });
    // Schedule due in the past
    mkSchedule({ dueAt: '2020-01-01T00:00:00.000Z' });

    const result = await runner.tick();
    expect(result.fired).toBe(1);
  });
});

// ─── tick — runOperation call shape ───────────────────────────────────────────

describe('tick — runOperation call shape', () => {
  it('passes correct opRef to runOperation', async () => {
    const runOp  = makeRunOp();
    const runner = new ScheduleRunner(adapter, runOp, { nextFireAt: mockNextFireAt() });
    mkSchedule({
      dueAt: '2026-06-27T01:00:00.000Z',
      actionId:   'bbbbbbbb-0000-0000-0000-000000000001',
      actionType: 'pipeline',
    });

    await runner.tick('2026-06-27T02:00:00.000Z');
    expect(runOp.calls[0].opRef).toEqual({ type: 'pipeline', id: 'bbbbbbbb-0000-0000-0000-000000000001' });
  });

  it('injects scheduleId and firedAt into params', async () => {
    const runOp  = makeRunOp();
    const runner = new ScheduleRunner(adapter, runOp, { nextFireAt: mockNextFireAt() });
    const item = mkSchedule({ dueAt: '2026-06-27T01:00:00.000Z' });

    await runner.tick('2026-06-27T02:00:00.000Z');
    const { params } = runOp.calls[0];
    expect(params.scheduleId).toBe(item.id);
    expect(params.firedAt).toBe('2026-06-27T02:00:00.000Z');
  });

  it('injects targetItemId into params', async () => {
    const runOp  = makeRunOp();
    const runner = new ScheduleRunner(adapter, runOp, { nextFireAt: mockNextFireAt() });
    const targetItem = adapter.create({ value: 'Target' });
    mkSchedule({ dueAt: '2026-06-27T01:00:00.000Z', targetItemId: targetItem.id });

    await runner.tick('2026-06-27T02:00:00.000Z');
    expect(runOp.calls[0].params.targetItemId).toBe(targetItem.id);
  });

  it('merges static params with runtime params', async () => {
    const runOp  = makeRunOp();
    const runner = new ScheduleRunner(adapter, runOp, { nextFireAt: mockNextFireAt() });
    mkSchedule({ dueAt: '2026-06-27T01:00:00.000Z', params: { env: 'production', retries: 3 } });

    await runner.tick('2026-06-27T02:00:00.000Z');
    const { params } = runOp.calls[0];
    expect(params.env).toBe('production');
    expect(params.retries).toBe(3);
    expect(params.firedAt).toBeDefined();
  });

  it('null targetItemId becomes null in params', async () => {
    const runOp  = makeRunOp();
    const runner = new ScheduleRunner(adapter, runOp, { nextFireAt: mockNextFireAt() });
    mkSchedule({ dueAt: '2026-06-27T01:00:00.000Z', targetItemId: null });

    await runner.tick('2026-06-27T02:00:00.000Z');
    expect(runOp.calls[0].params.targetItemId).toBeNull();
  });
});

// ─── tick — state update after fire ───────────────────────────────────────────

describe('tick — state update after fire', () => {
  it('updates lastFiredAt and lastResult on success', async () => {
    const runner = new ScheduleRunner(adapter, makeRunOp(), { nextFireAt: mockNextFireAt() });
    const item   = mkSchedule({ dueAt: '2026-06-27T01:00:00.000Z' });

    await runner.tick('2026-06-27T02:00:00.000Z');

    const sched = adapter.readScheduleJson(item.id);
    expect(sched.lastFiredAt).toBe('2026-06-27T02:00:00.000Z');
    expect(sched.lastResult).toBe('ok');
    expect(sched.lastError).toBeNull();
  });

  it('advances dueAt to next occurrence', async () => {
    const nfa    = mockNextFireAt('2026-06-28T02:00:00.000Z');
    const runner = new ScheduleRunner(adapter, makeRunOp(), { nextFireAt: nfa });
    const item   = mkSchedule({ dueAt: '2026-06-27T01:00:00.000Z' });

    await runner.tick('2026-06-27T02:00:00.000Z');

    const updated = adapter.get(item.id);
    expect(updated.dueAt).toBe('2026-06-28T02:00:00.000Z');
  });

  it('passes cronExpression, timezone, and firedAt to nextFireAt', async () => {
    const nfa    = mockNextFireAt('2026-06-28T02:00:00.000Z');
    const runner = new ScheduleRunner(adapter, makeRunOp(), { nextFireAt: nfa });
    mkSchedule({
      dueAt: '2026-06-27T01:00:00.000Z',
      cronExpression: '0 2 * * *',
      timezone: 'Pacific/Auckland',
    });

    await runner.tick('2026-06-27T02:00:00.000Z');

    expect(nfa.calls[0].expr).toBe('0 2 * * *');
    expect(nfa.calls[0].tz).toBe('Pacific/Auckland');
    expect(nfa.calls[0].after).toBe('2026-06-27T02:00:00.000Z');
  });

  it('pauses the schedule when nextFireAt returns null', async () => {
    const nfa    = mockNextFireAt(null);
    const runner = new ScheduleRunner(adapter, makeRunOp(), { nextFireAt: nfa });
    const item   = mkSchedule({ dueAt: '2026-06-27T01:00:00.000Z' });

    await runner.tick('2026-06-27T02:00:00.000Z');

    const updated = adapter.get(item.id);
    expect(updated.status).toBe('paused');
    expect(updated.dueAt).toBeNull();
  });
});

// ─── tick — failure handling ───────────────────────────────────────────────────

describe('tick — failure handling', () => {
  it('records error state on runOp failure', async () => {
    const failOp = makeRunOp(() => { throw new Error('connection refused'); });
    const runner = new ScheduleRunner(adapter, failOp, { nextFireAt: mockNextFireAt() });
    const item   = mkSchedule({ dueAt: '2026-06-27T01:00:00.000Z' });

    await runner.tick('2026-06-27T02:00:00.000Z');

    const sched = adapter.readScheduleJson(item.id);
    expect(sched.lastResult).toBe('error');
    expect(sched.lastError).toContain('connection refused');
    expect(sched.lastFiredAt).toBe('2026-06-27T02:00:00.000Z');
  });

  it('still advances dueAt after a failed fire', async () => {
    const nfa    = mockNextFireAt('2026-06-28T02:00:00.000Z');
    const failOp = makeRunOp(() => { throw new Error('oops'); });
    const runner = new ScheduleRunner(adapter, failOp, { nextFireAt: nfa });
    const item   = mkSchedule({ dueAt: '2026-06-27T01:00:00.000Z' });

    await runner.tick('2026-06-27T02:00:00.000Z');

    const updated = adapter.get(item.id);
    expect(updated.dueAt).toBe('2026-06-28T02:00:00.000Z');
  });

  it('counts failed fires in result', async () => {
    const failOp = makeRunOp(() => { throw new Error('bad'); });
    const runner = new ScheduleRunner(adapter, failOp, { nextFireAt: mockNextFireAt() });
    mkSchedule({ dueAt: '2026-06-27T01:00:00.000Z' });

    const result = await runner.tick('2026-06-27T02:00:00.000Z');
    expect(result).toEqual({ fired: 0, failed: 1 });
  });

  it('does not stop on one failure — fires remaining schedules', async () => {
    let callCount = 0;
    const mixedOp = makeRunOp(() => {
      callCount++;
      if (callCount === 1) throw new Error('first fails');
    });
    const runner = new ScheduleRunner(adapter, mixedOp, { nextFireAt: mockNextFireAt() });
    mkSchedule({ dueAt: '2026-06-27T01:00:00.000Z', actionId: 'aaaaaaaa-0000-0000-0000-000000000001' });
    mkSchedule({ dueAt: '2026-06-27T01:00:00.000Z', actionId: 'aaaaaaaa-0000-0000-0000-000000000002' });

    const result = await runner.tick('2026-06-27T02:00:00.000Z');
    expect(result).toEqual({ fired: 1, failed: 1 });
    expect(mixedOp.calls).toHaveLength(2);
  });

  it('truncates long error messages to 2000 chars', async () => {
    const longMsg = 'x'.repeat(5000);
    const failOp  = makeRunOp(() => { throw new Error(longMsg); });
    const runner  = new ScheduleRunner(adapter, failOp, { nextFireAt: mockNextFireAt() });
    const item    = mkSchedule({ dueAt: '2026-06-27T01:00:00.000Z' });

    await runner.tick('2026-06-27T02:00:00.000Z');

    const sched = adapter.readScheduleJson(item.id);
    expect(sched.lastError.length).toBe(2000);
  });

  it('throws (counted as failed) when schedule payload is missing', async () => {
    const runOp  = makeRunOp();
    const runner = new ScheduleRunner(adapter, runOp, { nextFireAt: mockNextFireAt() });
    const item   = adapter.create({ type: 'schedule', value: 'No Payload', status: 'active', dueAt: '2026-06-27T01:00:00.000Z' });

    const result = await runner.tick('2026-06-27T02:00:00.000Z');
    expect(result.failed).toBe(1);
    // runOp was never called
    expect(runOp.calls).toHaveLength(0);
    // dueAt not advanced (no schedule to read)
    expect(adapter.get(item.id).dueAt).toBe('2026-06-27T01:00:00.000Z');
  });
});

// ─── adapter — readScheduleJson / writeScheduleJson ───────────────────────────

describe('adapter readScheduleJson / writeScheduleJson', () => {
  it('returns null when no payload is set', () => {
    const item = adapter.create({ type: 'schedule', value: 'x' });
    expect(adapter.readScheduleJson(item.id)).toBeNull();
  });

  it('round-trips the full payload', () => {
    const item = adapter.create({ type: 'schedule', value: 'x' });
    const data = {
      cronExpression: '0 9 * * 1',
      timezone: 'Pacific/Auckland',
      actionId: 'cccccccc-0000-0000-0000-000000000001',
      actionType: 'function',
      targetItemId: null,
      params: { env: 'prod' },
      lastFiredAt: null,
      lastResult: null,
      lastError: null,
    };
    adapter.writeScheduleJson(item.id, data);
    expect(adapter.readScheduleJson(item.id)).toEqual(data);
  });

  it('can be overwritten', () => {
    const item = adapter.create({ type: 'schedule', value: 'x' });
    adapter.writeScheduleJson(item.id, { cronExpression: '0 1 * * *', actionId: 'a', actionType: 'function' });
    adapter.writeScheduleJson(item.id, { cronExpression: '0 2 * * *', actionId: 'b', actionType: 'pipeline' });
    expect(adapter.readScheduleJson(item.id).cronExpression).toBe('0 2 * * *');
  });

  it('update() does not wipe schedule_data', () => {
    const item = adapter.create({ type: 'schedule', value: 'x', status: 'active' });
    adapter.writeScheduleJson(item.id, { cronExpression: '0 1 * * *', actionId: 'a', actionType: 'function' });
    adapter.update(item.id, { status: 'paused' });
    expect(adapter.readScheduleJson(item.id)).not.toBeNull();
    expect(adapter.readScheduleJson(item.id).cronExpression).toBe('0 1 * * *');
  });
});

// ─── adapter — listDueSchedules ───────────────────────────────────────────────

describe('adapter listDueSchedules', () => {
  it('returns schedule items due before beforeAt', () => {
    const item = mkSchedule({ dueAt: '2026-06-27T01:00:00.000Z' });
    const due  = adapter.listDueSchedules('2026-06-27T02:00:00.000Z');
    expect(due.map(d => d.id)).toContain(item.id);
  });

  it('excludes schedules due after beforeAt', () => {
    const item = mkSchedule({ dueAt: '2026-06-28T02:00:00.000Z' });
    const due  = adapter.listDueSchedules('2026-06-27T02:00:00.000Z');
    expect(due.map(d => d.id)).not.toContain(item.id);
  });

  it('excludes paused schedules', () => {
    const item = mkSchedule({ status: 'paused', dueAt: '2026-06-27T01:00:00.000Z' });
    const due  = adapter.listDueSchedules('2026-06-27T02:00:00.000Z');
    expect(due.map(d => d.id)).not.toContain(item.id);
  });

  it('excludes deleted schedules', () => {
    const item = mkSchedule({ dueAt: '2026-06-27T01:00:00.000Z' });
    adapter.delete(item.id);
    expect(adapter.listDueSchedules('2026-06-27T02:00:00.000Z')).toHaveLength(0);
  });

  it('excludes non-schedule items even if status=active and due_at is past', () => {
    const item = adapter.create({ type: 'string', value: 'x', status: 'active', dueAt: '2026-06-27T01:00:00.000Z' });
    const due  = adapter.listDueSchedules('2026-06-27T02:00:00.000Z');
    expect(due.map(d => d.id)).not.toContain(item.id);
  });

  it('returns empty array when nothing is due', () => {
    expect(adapter.listDueSchedules('2000-01-01T00:00:00.000Z')).toEqual([]);
  });
});

// ─── real cron-parser integration ─────────────────────────────────────────────

describe('real cron-parser integration', () => {
  it('fires and advances dueAt to a real next occurrence', async () => {
    const runOp  = makeRunOp();
    const runner = new ScheduleRunner(adapter, runOp);  // real nextFireAt
    const item = adapter.create({
      type: 'schedule', value: 'Hourly', status: 'active',
      dueAt: '2026-06-27T01:00:00.000Z',
    });
    adapter.writeScheduleJson(item.id, {
      cronExpression: '0 * * * *',
      timezone: null,
      actionId:   'dddddddd-0000-0000-0000-000000000001',
      actionType: 'function',
      targetItemId: null,
      params: null,
      lastFiredAt: null, lastResult: null, lastError: null,
    });

    await runner.tick('2026-06-27T02:00:00.000Z');

    const updated = adapter.get(item.id);
    // Next fire should be at the top of the next hour after 2026-06-27T02:00:00Z
    expect(updated.dueAt).toBe('2026-06-27T03:00:00.000Z');
    expect(adapter.readScheduleJson(item.id).lastResult).toBe('ok');
  });

  it('fires with timezone-aware next occurrence', async () => {
    const runOp  = makeRunOp();
    const runner = new ScheduleRunner(adapter, runOp);
    const item = adapter.create({
      type: 'schedule', value: 'Daily NZ', status: 'active',
      dueAt: '2026-06-27T01:00:00.000Z',
    });
    adapter.writeScheduleJson(item.id, {
      cronExpression: '0 9 * * *',
      timezone: 'Pacific/Auckland',
      actionId:   'eeeeeeee-0000-0000-0000-000000000001',
      actionType: 'function',
      targetItemId: null,
      params: null,
      lastFiredAt: null, lastResult: null, lastError: null,
    });

    await runner.tick('2026-06-27T02:00:00.000Z');

    const updated = adapter.get(item.id);
    // 09:00 NZ time on 2026-06-28 = UTC 2026-06-27T21:00:00Z (NZ is UTC+12 in winter)
    expect(updated.dueAt).toBeDefined();
    expect(new Date(updated.dueAt) > new Date('2026-06-27T02:00:00.000Z')).toBe(true);
  });
});
