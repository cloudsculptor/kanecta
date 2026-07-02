'use strict';

const fs = require('fs');
const path = require('path');
const { parseTranscript } = require('./parse');

/**
 * Import parsed Claude Code transcripts into a Kanecta datastore as items.
 *
 * The import is DETERMINISTIC and IDEMPOTENT: every entity carries a stable
 * external key (`sourceSystem = 'claude-code'`, `sourceExternalId = <kind>:<id>`),
 * and each upsert is `bySource() ? update() : create()`. Re-importing the same
 * (or a grown) transcript never duplicates — it updates in place and appends new
 * turns. This is the "log everything Claude does into Connector" foundation.
 *
 * Item shape (everything-is-an-item; structured data on the object payload):
 *
 *   claude-session          (child of root; key session:<sessionId>)
 *     └─ claude-turn         (child of session; key turn:<uuid>)
 *          └─ claude-tool-call  (child of turn; key tool:<toolUseId>)
 */

const SOURCE_SYSTEM = 'claude-code';

const TYPE_SESSION = 'claude-session';
const TYPE_TURN = 'claude-turn';
const TYPE_TOOL_CALL = 'claude-tool-call';

const DEFAULTS = { maxTextChars: 20000, maxResultChars: 20000 };

function truncate(str, max) {
  if (typeof str !== 'string') return { text: str, truncated: false };
  if (max === Infinity || str.length <= max) return { text: str, truncated: false };
  return { text: str.slice(0, max) + `\n…[truncated ${str.length - max} chars]`, truncated: true };
}

function snippet(str, max = 100) {
  const s = String(str ?? '').replace(/\s+/g, ' ').trim();
  return s.length <= max ? s : s.slice(0, max) + '…';
}

function shortId(id) {
  return String(id ?? '').split('-')[0] || 'unknown';
}

function sessionLabel(session) {
  const firstUser = session.turns.find((t) => t.kind === 'user' && t.text);
  if (firstUser) return snippet(firstUser.text, 80);
  const dir = session.cwd ? path.basename(session.cwd) : null;
  return `Session ${shortId(session.sessionId)}${dir ? ` — ${dir}` : ''}`;
}

function turnLabel(turn) {
  if (turn.text) return `[${turn.kind}] ${snippet(turn.text, 90)}`;
  if (turn.toolCalls.length) {
    const names = turn.toolCalls.map((c) => c.name).filter(Boolean);
    return `[${turn.kind}] ${names.join(', ') || `${turn.toolCalls.length} tool call(s)`}`;
  }
  return `[${turn.kind}]`;
}

/**
 * Idempotent upsert by external key. Returns { item, created }.
 * `payload` (when provided) is written to the item's object payload.
 */
async function upsert(ds, { key, type, value, parentId, sortOrder, payload }) {
  const existing = await ds.bySource(SOURCE_SYSTEM, key);
  let item;
  let created;
  if (existing) {
    const changes = { value };
    if (parentId != null && existing.parentId !== parentId) changes.parentId = parentId;
    item = await ds.update(existing.id, changes);
    created = false;
  } else {
    item = await ds.create({
      type, value, parentId,
      ...(sortOrder != null ? { sortOrder } : {}),
      sourceSystem: SOURCE_SYSTEM, sourceExternalId: key,
    });
    created = true;
  }
  if (payload !== undefined) await ds.writeObjectJson(item.id, payload);
  return { item, created };
}

/**
 * Import one normalised session (from parseTranscript) into `ds`.
 * Returns per-run stats.
 */
async function importSession(ds, session, opts = {}) {
  const { maxTextChars, maxResultChars } = { ...DEFAULTS, ...opts };
  const stats = { sessionId: session.sessionId, created: 0, updated: 0, turns: 0, toolCalls: 0 };
  const bump = (created) => (created ? stats.created++ : stats.updated++);

  // 1. Session item (under root).
  const sessionRes = await upsert(ds, {
    key: `session:${session.sessionId}`,
    type: TYPE_SESSION,
    value: sessionLabel(session),
    parentId: null,
    payload: {
      sessionId: session.sessionId,
      cwd: session.cwd,
      gitBranch: session.gitBranch,
      version: session.version,
      startedAt: session.startedAt,
      endedAt: session.endedAt,
      models: session.models,
      tokens: session.tokens,
      turnCount: session.turnCount,
      toolCallCount: session.toolCallCount,
    },
  });
  bump(sessionRes.created);
  const sessionId = sessionRes.item.id;

  // 2. Turns (children of the session), in transcript order.
  let turnIndex = 0;
  for (const turn of session.turns) {
    if (!turn.uuid) continue; // cannot key a turn without an id
    const textCap = truncate(turn.text, maxTextChars);
    const turnRes = await upsert(ds, {
      key: `turn:${turn.uuid}`,
      type: TYPE_TURN,
      value: turnLabel(turn),
      parentId: sessionId,
      sortOrder: turnIndex++,
      payload: {
        kind: turn.kind,
        timestamp: turn.timestamp,
        model: turn.model,
        usage: turn.usage,
        parentUuid: turn.parentUuid,
        isSidechain: turn.isSidechain,
        agentId: turn.agentId,
        text: textCap.text,
        textTruncated: textCap.truncated,
        textLength: (turn.text || '').length,
        toolCallCount: turn.toolCalls.length,
      },
    });
    bump(turnRes.created);
    stats.turns++;

    // 3. Tool calls (children of the turn).
    let toolIndex = 0;
    for (const call of turn.toolCalls) {
      if (!call.toolUseId) continue;
      const resultCap = truncate(call.result, maxResultChars);
      const callRes = await upsert(ds, {
        key: `tool:${call.toolUseId}`,
        type: TYPE_TOOL_CALL,
        value: call.name || 'tool call',
        parentId: turnRes.item.id,
        sortOrder: toolIndex++,
        payload: {
          name: call.name,
          toolUseId: call.toolUseId,
          input: call.input,
          result: resultCap.text,
          resultTruncated: resultCap.truncated,
          isError: call.isError,
        },
      });
      bump(callRes.created);
      stats.toolCalls++;
    }
  }

  return stats;
}

/** Read a transcript JSONL file and import every session it contains. */
async function importTranscriptFile(ds, filePath, opts = {}) {
  const text = fs.readFileSync(filePath, 'utf8');
  const sessions = parseTranscript(text);
  const results = [];
  for (const session of sessions) {
    results.push(await importSession(ds, session, opts));
  }
  return results;
}

/** Recursively find `*.jsonl` transcript files under a directory. */
function findTranscriptFiles(dir) {
  const out = [];
  const walk = (d) => {
    let entries;
    try { entries = fs.readdirSync(d, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      const full = path.join(d, e.name);
      if (e.isDirectory()) walk(full);
      else if (e.isFile() && e.name.endsWith('.jsonl')) out.push(full);
    }
  };
  walk(dir);
  return out.sort();
}

module.exports = {
  SOURCE_SYSTEM,
  TYPE_SESSION,
  TYPE_TURN,
  TYPE_TOOL_CALL,
  importSession,
  importTranscriptFile,
  findTranscriptFiles,
};
