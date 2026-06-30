'use strict';

// ─── Write integrity: cross-process lock + write-ahead journal ──────────────────
//
// Implements the filesystem half of the spec's Write Integrity & Durability
// chapter. A write to a branch is serialized behind a cross-process lock and
// recorded in a write-ahead journal so a crash can never leave a half-applied
// write. The lock and journal live durably at the branch root —
//   <branchRoot>/write.lock      { pid, host, startedAt, heartbeatAt }
//   <branchRoot>/write.journal   { phase, branch, ops:[{id,store,preImage}], … }
// — never inside index.db (which is derived and disposable).
//
// Recovery hinges on one question: did the authoritative L0 write complete?
//   phase 'l0-done'  → data is fully on disk → roll forward (rebuild the index).
//   phase 'started'  → the write may be partial → roll back to the pre-images.
//   no journal       → nothing to recover.
//
// Both better-sqlite3 and this adapter are synchronous, so writes within a single
// process are already serialized by the event loop; the lock exists to serialize
// across processes (the MCP server, the API and the CLI may share one datastore).

const fs   = require('fs');
const os   = require('os');
const path = require('path');

// Synchronous sleep (no busy-spin). Used while waiting for a contended lock.
function sleepSync(ms) {
  if (ms <= 0) return;
  const shared = new Int32Array(new SharedArrayBuffer(4));
  Atomics.wait(shared, 0, 0, ms);
}

class WriteGuard {
  // `nowMs` and `sleep` are injectable for deterministic tests.
  constructor(branchRoot, { nowMs = Date.now, sleep = sleepSync } = {}) {
    this.branchRoot = branchRoot;
    this._nowMs = nowMs;
    this._sleep = sleep;
    this._held  = false;
  }

  get lockPath()    { return path.join(this.branchRoot, 'write.lock'); }
  get journalPath() { return path.join(this.branchRoot, 'write.journal'); }

  // ── Lock ──────────────────────────────────────────────────────────────────

  _readLock() {
    try { return JSON.parse(fs.readFileSync(this.lockPath, 'utf8')); }
    catch { return null; }
  }

  // A lock is stale if its holder is provably gone: a dead PID on this host, or an
  // expired heartbeat (covers other hosts and hung processes).
  _lockIsStale(lock, staleMs) {
    if (!lock) return true;
    if (lock.host === os.hostname() && Number.isInteger(lock.pid)) {
      try { process.kill(lock.pid, 0); }            // probe — does not actually signal
      catch (e) { if (e.code === 'ESRCH') return true; } // no such process → crashed holder
    }
    const beat = lock.heartbeatAt ?? lock.startedAt ?? 0;
    return (this._nowMs() - beat) > staleMs;
  }

  // Acquire the branch lock, stealing a stale one and waiting (up to waitMs) for a
  // live one. Throws if the wait times out.
  acquire({ pid = process.pid, staleMs = 30000, waitMs = 10000, pollMs = 25 } = {}) {
    const deadline = this._nowMs() + waitMs;
    fs.mkdirSync(this.branchRoot, { recursive: true });
    for (;;) {
      try {
        const fd = fs.openSync(this.lockPath, 'wx'); // O_CREAT|O_EXCL — atomic create
        fs.writeSync(fd, JSON.stringify({ pid, host: os.hostname(), startedAt: this._nowMs(), heartbeatAt: this._nowMs() }));
        fs.closeSync(fd);
        this._held = true;
        return true;
      } catch (e) {
        if (e.code !== 'EEXIST') throw e;
        const lock = this._readLock();
        if (this._lockIsStale(lock, staleMs)) {
          try { fs.rmSync(this.lockPath, { force: true }); } catch {}
          continue; // retry the exclusive create
        }
        if (this._nowMs() >= deadline) {
          const err = new Error(`write lock held by another process: ${JSON.stringify(lock)}`);
          err.code = 'KANECTA_WRITE_LOCKED';
          throw err;
        }
        this._sleep(pollMs);
      }
    }
  }

  // Refresh the heartbeat during a long write so watchers don't deem us stale.
  heartbeat() {
    if (!this._held) return;
    const lock = this._readLock();
    if (!lock) return;
    lock.heartbeatAt = this._nowMs();
    this._atomicWrite(this.lockPath, JSON.stringify(lock));
  }

  release() {
    this._held = false;
    try { fs.rmSync(this.lockPath, { force: true }); } catch {}
  }

  // Clear a leftover lock from a crashed holder. Returns true if one was cleared.
  clearStaleLock({ staleMs = 30000 } = {}) {
    const lock = this._readLock();
    if (lock && this._lockIsStale(lock, staleMs)) {
      try { fs.rmSync(this.lockPath, { force: true }); } catch {}
      return true;
    }
    return false;
  }

  // ── Journal ─────────────────────────────────────────────────────────────────

  _atomicWrite(p, contents) {
    const tmp = p + '.tmp';
    fs.writeFileSync(tmp, contents, 'utf8');
    fs.renameSync(tmp, p);
  }

  // Record write-ahead intent. `ops` is [{ id, store, preImage }] — preImage is the
  // item.json before this write (null for a freshly-created item), used to roll back.
  begin(entry) {
    this._atomicWrite(this.journalPath, JSON.stringify({ phase: 'started', startedAt: this._nowMs(), ...entry }));
  }

  // Mark the authoritative data as fully written: recovery will now roll forward.
  markL0Done() {
    const j = this.read();
    if (!j) return;
    j.phase = 'l0-done';
    this._atomicWrite(this.journalPath, JSON.stringify(j));
  }

  read() {
    try { return JSON.parse(fs.readFileSync(this.journalPath, 'utf8')); }
    catch { return null; }
  }

  // Commit = the write fully landed; the journal is no longer needed.
  commit() {
    try { fs.rmSync(this.journalPath, { force: true }); } catch {}
  }
}

module.exports = { WriteGuard, sleepSync };
