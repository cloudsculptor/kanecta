'use strict';

// ScheduleRunner — fires active schedule items whose next fire time is due.
//
// Usage:
//   const runner = new ScheduleRunner(adapter, runOperation);
//   await runner.tick();                    // call this on a regular interval
//   await runner.tick('2026-06-28T02:00:00Z');  // or with an explicit "now"
//
// runOperation(operationRef, params) — async callback that executes a function
// or pipeline item. Same contract as ConnectorEngine:
//   operationRef = { type: 'function' | 'pipeline', id: '<uuid>' }
//   params = { scheduleId, targetItemId, firedAt, ...staticParams }
//
// The runner is adapter-agnostic (works with SQLite sync and Postgres async)
// because all calls are awaited.
//
// Dependency injection for cron parsing lets tests run without the real
// cron-parser library by passing a mock via the third constructor argument.

import { CronExpressionParser } from 'cron-parser';

const MAX_ERROR_LENGTH = 2000;

function defaultNextFireAt(cronExpression: any, timezone: any, after: any) {
  const opts: any = { currentDate: new Date(after) };
  if (timezone) opts.tz = timezone;
  const interval = CronExpressionParser.parse(cronExpression, opts);
  const next = interval.next();
  return next ? next.toISOString() : null;
}

class ScheduleRunner {
  _adapter: any;
  _runOp: any;
  _nextFireAt: any;

  constructor(adapter: any, runOperation: any, { nextFireAt = defaultNextFireAt }: any = {}) {
    this._adapter    = adapter;
    this._runOp      = runOperation;
    this._nextFireAt = nextFireAt;
  }

  // Fire all active schedules due by `now` (defaults to current UTC time).
  // Returns { fired, failed }.
  async tick(now: any = new Date().toISOString()) {
    const due = await this._adapter.listDueSchedules(now);
    let fired  = 0;
    let failed = 0;
    for (const item of due) {
      try {
        await this._fireSchedule(item, now);
        fired++;
      } catch (err: any) {
        failed++;
        console.warn(`[ScheduleRunner] Failed to fire schedule ${item.id}: ${err.message}`);
      }
    }
    return { fired, failed };
  }

  // Execute one schedule item and advance its next fire time.
  async _fireSchedule(item: any, now: any) {
    const schedule = await this._adapter.readScheduleJson(item.id);
    if (!schedule) throw new Error(`Schedule payload missing on item: ${item.id}`);

    const { cronExpression, timezone, actionId, actionType, targetItemId, params } = schedule;
    if (!actionId)   throw new Error(`Schedule ${item.id} has no actionId`);
    if (!actionType) throw new Error(`Schedule ${item.id} has no actionType`);
    if (!['function', 'pipeline'].includes(actionType)) {
      throw new Error(`Schedule ${item.id} has invalid actionType: "${actionType}"`);
    }

    let lastResult = 'ok';
    let lastError: any  = null;
    let runError: any   = null;

    try {
      await this._runOp(
        { type: actionType, id: actionId },
        { scheduleId: item.id, targetItemId: targetItemId ?? null, firedAt: now, ...(params ?? {}) },
      );
    } catch (err: any) {
      lastResult = 'error';
      lastError  = String(err.message ?? err).slice(0, MAX_ERROR_LENGTH);
      runError   = err;
    }

    const nextDueAt = cronExpression
      ? this._nextFireAt(cronExpression, timezone ?? null, now)
      : null;

    // Write updated schedule payload and advance dueAt — always, even on failure.
    await this._adapter.writeScheduleJson(item.id, {
      ...schedule,
      lastFiredAt: now,
      lastResult,
      lastError,
    });

    if (nextDueAt) {
      await this._adapter.update(item.id, { dueAt: nextDueAt });
    } else {
      await this._adapter.update(item.id, { dueAt: null, status: 'paused' });
    }

    // Rethrow so tick() counts this as failed and the caller can observe it.
    if (runError) throw runError;
  }
}

export { ScheduleRunner };
