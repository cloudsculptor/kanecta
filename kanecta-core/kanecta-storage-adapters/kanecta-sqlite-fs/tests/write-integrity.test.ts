'use strict';

import fs from 'fs';
import os from 'os';
import path from 'path';

import { WriteGuard } from '../src/write-integrity';

let dir;
beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kanecta-wg-')); });
afterEach(() => { try { fs.rmSync(dir, { recursive: true, force: true }); } catch {} });

describe('WriteGuard — lock', () => {
  it('acquires and releases a lock (creates then removes write.lock)', () => {
    const g = new WriteGuard(dir);
    g.acquire();
    expect(fs.existsSync(g.lockPath)).toBe(true);
    const lock = JSON.parse(fs.readFileSync(g.lockPath, 'utf8'));
    expect(lock.pid).toBe(process.pid);
    expect(lock.host).toBe(os.hostname());
    g.release();
    expect(fs.existsSync(g.lockPath)).toBe(false);
  });

  it('a second acquire times out while a live lock is held', () => {
    const g1 = new WriteGuard(dir);
    g1.acquire();
    const g2 = new WriteGuard(dir);
    expect(() => g2.acquire({ waitMs: 30, pollMs: 5 })).toThrow(/write lock held/);
    g1.release();
    expect(() => g2.acquire()).not.toThrow();
    g2.release();
  });

  it('steals a stale lock whose PID is dead', () => {
    const g = new WriteGuard(dir);
    // Plant a lock owned by a definitely-dead PID on this host.
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(g.lockPath, JSON.stringify({ pid: 2 ** 30, host: os.hostname(), startedAt: Date.now(), heartbeatAt: Date.now() }));
    // Should steal immediately (no wait) because the PID is not alive.
    expect(() => g.acquire({ waitMs: 0 })).not.toThrow();
    expect(JSON.parse(fs.readFileSync(g.lockPath, 'utf8')).pid).toBe(process.pid);
    g.release();
  });

  it('steals a lock whose heartbeat has expired (other host / hung)', () => {
    let t = 1_000_000;
    const g = new WriteGuard(dir, { nowMs: () => t });
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(g.lockPath, JSON.stringify({ pid: process.pid, host: 'some-other-host', startedAt: 0, heartbeatAt: 0 }));
    g.acquire({ staleMs: 100, waitMs: 0 }); // heartbeat at 0, now=1e6 → stale
    expect(JSON.parse(fs.readFileSync(g.lockPath, 'utf8')).host).toBe(os.hostname());
    g.release();
  });

  it('clearStaleLock removes a dead lock and leaves a live one', () => {
    const g = new WriteGuard(dir);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(g.lockPath, JSON.stringify({ pid: 2 ** 30, host: os.hostname(), heartbeatAt: Date.now() }));
    expect(g.clearStaleLock()).toBe(true);
    expect(fs.existsSync(g.lockPath)).toBe(false);

    g.acquire();
    expect(g.clearStaleLock()).toBe(false); // our own live lock is kept
    g.release();
  });
});

describe('WriteGuard — journal', () => {
  it('begin writes a started journal; commit removes it', () => {
    const g = new WriteGuard(dir);
    fs.mkdirSync(dir, { recursive: true });
    g.begin({ branch: 'main', ops: [{ id: 'x', store: 'items', preImage: null }] });
    const j = g.read();
    expect(j.phase).toBe('started');
    expect(j.branch).toBe('main');
    expect(j.ops[0].id).toBe('x');
    g.commit();
    expect(g.read()).toBeNull();
  });

  it('markL0Done advances the phase for roll-forward', () => {
    const g = new WriteGuard(dir);
    fs.mkdirSync(dir, { recursive: true });
    g.begin({ branch: 'main', ops: [] });
    g.markL0Done();
    expect(g.read().phase).toBe('l0-done');
  });

  it('preserves the pre-image so a rollback can restore prior state', () => {
    const g = new WriteGuard(dir);
    fs.mkdirSync(dir, { recursive: true });
    const preImage = { item: { id: 'x', value: 'before' } };
    g.begin({ branch: 'main', ops: [{ id: 'x', store: 'items', preImage }] });
    expect(g.read().ops[0].preImage).toEqual(preImage);
  });
});
