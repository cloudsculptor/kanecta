'use strict';

const fs = require('fs');
const path = require('path');
const { parseTranscript } = require('./parse');
const { ensureTypes, TYPE_IDS } = require('./types');

/**
 * Import parsed Claude Code transcripts into a Kanecta datastore as TYPED OBJECTS.
 *
 * Every entity is a `type:'object'` item whose payload is a flat, schema-defined
 * shape (see ./types.js) — portable across the filesystem and Postgres backends.
 * Variable maps (a tool call's arguments, a session's model list) are decomposed
 * into child `property` (key-value) items, because a flat SQL row cannot hold a
 * per-tool-varying map and the canonical schema has no JSON column.
 *
 * The import is DETERMINISTIC and IDEMPOTENT: every entity carries a stable
 * external key (`sourceSystem = 'claude-code'`, `sourceExternalId = <kind>:<id>`),
 * and each upsert is `bySource() ? update() : create()`. Re-importing the same (or
 * a grown) transcript never duplicates — it updates in place and appends new turns.
 *
 *   claude-session          (child of root;    key session:<sessionId>)
 *     ├─ property            (a model used;     key session:<sessionId>:model:<m>)
 *     └─ claude-turn         (child of session; key turn:<uuid>)
 *          └─ claude-tool-call  (child of turn; key tool:<toolUseId>)
 *               └─ property     (an argument;   key tool:<toolUseId>:param:<name>)
 */

const SOURCE_SYSTEM = 'claude-code';

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

/** Coerce any tool-argument value to the `property.value` TEXT column. */
function toText(v) {
  if (v == null) return '';
  if (typeof v === 'string') return v;
  if (typeof v === 'object') return JSON.stringify(v);
  return String(v);
}

/**
 * Idempotent upsert of a typed-object item by external key. Returns
 * { item, created }. `objectData` is the typed payload (columns).
 */
async function upsert(ds, { key, typeId, value, parentId, sortOrder, objectData }) {
  const existing = await ds.bySource(SOURCE_SYSTEM, key);
  if (existing) {
    const changes = { value };
    if (parentId != null && existing.parentId !== parentId) changes.parentId = parentId;
    await ds.update(existing.id, changes);
    if (objectData !== undefined) await ds.writeObjectJson(existing.id, objectData);
    return { item: existing, created: false };
  }
  const item = await ds.create({
    type: 'object', typeId, value, parentId,
    ...(sortOrder != null ? { sortOrder } : {}),
    objectData,
    sourceSystem: SOURCE_SYSTEM, sourceExternalId: key,
  });
  return { item, created: true };
}

/** Upsert one child `property` item. */
async function upsertProperty(ds, { key, parentId, sortOrder, name, value }) {
  return upsert(ds, {
    key,
    typeId: TYPE_IDS.property,
    value: name,
    parentId,
    sortOrder,
    objectData: { name, value },
  });
}

/**
 * Import one normalised session (from parseTranscript) into `ds` as typed
 * objects. Ensures the transcript types exist first (idempotent). Returns stats.
 */
async function importSession(ds, session) {
  await ensureTypes(ds);

  const stats = { sessionId: session.sessionId, created: 0, updated: 0, turns: 0, toolCalls: 0, properties: 0 };
  const bump = (r) => { r.created ? stats.created++ : stats.updated++; return r; };

  // 1. Session object (under root).
  const sessionRes = bump(await upsert(ds, {
    key: `session:${session.sessionId}`,
    typeId: TYPE_IDS.session,
    value: sessionLabel(session),
    parentId: null,
    objectData: {
      sessionId: session.sessionId,
      cwd: session.cwd,
      gitBranch: session.gitBranch,
      version: session.version,
      startedAt: session.startedAt,
      endedAt: session.endedAt,
      turnCount: session.turnCount,
      toolCallCount: session.toolCallCount,
      tokensInput: session.tokens.input,
      tokensOutput: session.tokens.output,
      tokensCacheCreation: session.tokens.cacheCreation,
      tokensCacheRead: session.tokens.cacheRead,
    },
  }));
  const sessionId = sessionRes.item.id;

  // 1a. The session's models — a scalar list, decomposed into child properties.
  let modelIdx = 0;
  for (const model of session.models) {
    bump(await upsertProperty(ds, {
      key: `session:${session.sessionId}:model:${model}`,
      parentId: sessionId,
      sortOrder: modelIdx++,
      name: 'model',
      value: model,
    }));
    stats.properties++;
  }

  // 2. Turns (children of the session), in transcript order.
  let turnIndex = 0;
  for (const turn of session.turns) {
    if (!turn.uuid) continue; // cannot key a turn without an id
    const turnRes = bump(await upsert(ds, {
      key: `turn:${turn.uuid}`,
      typeId: TYPE_IDS.turn,
      value: turnLabel(turn),
      parentId: sessionId,
      sortOrder: turnIndex++,
      objectData: {
        kind: turn.kind,
        timestamp: turn.timestamp,
        model: turn.model,
        usageInput: turn.usage ? turn.usage.input : null,
        usageOutput: turn.usage ? turn.usage.output : null,
        usageCacheCreation: turn.usage ? turn.usage.cacheCreation : null,
        usageCacheRead: turn.usage ? turn.usage.cacheRead : null,
        parentUuid: turn.parentUuid,
        isSidechain: turn.isSidechain,
        agentId: turn.agentId,
        text: turn.text,
        textLength: (turn.text || '').length,
      },
    }));
    stats.turns++;

    // 3. Tool calls (children of the turn).
    let toolIndex = 0;
    for (const call of turn.toolCalls) {
      if (!call.toolUseId) continue;
      const callRes = bump(await upsert(ds, {
        key: `tool:${call.toolUseId}`,
        typeId: TYPE_IDS.toolCall,
        value: call.name || 'tool call',
        parentId: turnRes.item.id,
        sortOrder: toolIndex++,
        objectData: {
          name: call.name,
          toolUseId: call.toolUseId,
          isError: call.isError,
          result: call.result,
        },
      }));
      stats.toolCalls++;

      // 3a. The tool's arguments — a variable map, decomposed into properties.
      let paramIdx = 0;
      const input = call.input && typeof call.input === 'object' ? call.input : {};
      for (const [name, raw] of Object.entries(input)) {
        bump(await upsertProperty(ds, {
          key: `tool:${call.toolUseId}:param:${name}`,
          parentId: callRes.item.id,
          sortOrder: paramIdx++,
          name,
          value: toText(raw),
        }));
        stats.properties++;
      }
    }
  }

  return stats;
}

/** Read a transcript JSONL file and import every session it contains. */
async function importTranscriptFile(ds, filePath) {
  const text = fs.readFileSync(filePath, 'utf8');
  const sessions = parseTranscript(text);
  const results = [];
  for (const session of sessions) {
    results.push(await importSession(ds, session));
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
  TYPE_IDS,
  ensureTypes,
  importSession,
  importTranscriptFile,
  findTranscriptFiles,
};
