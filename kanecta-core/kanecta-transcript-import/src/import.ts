import fs from 'fs';
import path from 'path';
import { parseTranscript, type Session, type Turn } from './parse.js';
import { ensureTypes, TYPE_IDS } from './types.js';

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

function snippet(str: unknown, max = 100): string {
  const s = String(str ?? '').replace(/\s+/g, ' ').trim();
  return s.length <= max ? s : s.slice(0, max) + '…';
}

function shortId(id: unknown): string {
  return String(id ?? '').split('-')[0] || 'unknown';
}

function sessionLabel(session: Session): string {
  const firstUser = session.turns.find((t) => t.kind === 'user' && t.text);
  if (firstUser) return snippet(firstUser.text, 80);
  const dir = session.cwd ? path.basename(session.cwd) : null;
  return `Session ${shortId(session.sessionId)}${dir ? ` — ${dir}` : ''}`;
}

function turnLabel(turn: Turn): string {
  if (turn.text) return `[${turn.kind}] ${snippet(turn.text, 90)}`;
  if (turn.toolCalls.length) {
    const names = turn.toolCalls.map((c) => c.name).filter(Boolean);
    return `[${turn.kind}] ${names.join(', ') || `${turn.toolCalls.length} tool call(s)`}`;
  }
  return `[${turn.kind}]`;
}

/** Coerce any tool-argument value to the `property.value` TEXT column. */
function toText(v: unknown): string {
  if (v == null) return '';
  if (typeof v === 'string') return v;
  if (typeof v === 'object') return JSON.stringify(v);
  return String(v);
}

interface UpsertArgs {
  key: string;
  typeId: string;
  value: string;
  parentId: string | null;
  sortOrder?: number;
  objectData?: any;
}

interface UpsertResult {
  item: any;
  created: boolean;
}

/**
 * Idempotent upsert of a typed-object item by external key. Returns
 * { item, created }. `objectData` is the typed payload (columns).
 */
async function upsert(ds: any, { key, typeId, value, parentId, sortOrder, objectData }: UpsertArgs): Promise<UpsertResult> {
  const existing = await ds.bySource(SOURCE_SYSTEM, key);
  if (existing) {
    const changes: any = { value };
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

interface UpsertPropertyArgs {
  key: string;
  parentId: string | null;
  sortOrder?: number;
  mapKey: string;
  value: string;
}

/**
 * Upsert one child `property` item (a map entry). The map key is the item's
 * value (`item.value`); the payload holds just the value — matching the core
 * `property` type and the spec's `map` child-semantics.
 */
async function upsertProperty(ds: any, { key, parentId, sortOrder, mapKey, value }: UpsertPropertyArgs): Promise<UpsertResult> {
  return upsert(ds, {
    key,
    typeId: TYPE_IDS.property,
    value: mapKey,
    parentId,
    sortOrder,
    objectData: { value },
  });
}

/**
 * Import one normalised session (from parseTranscript) into `ds` as typed
 * objects. Ensures the transcript types exist first (idempotent). Returns stats.
 */
export async function importSession(ds: any, session: Session) {
  await ensureTypes(ds);

  const stats = { sessionId: session.sessionId, created: 0, updated: 0, turns: 0, toolCalls: 0, properties: 0 };
  const bump = (r: UpsertResult): UpsertResult => { r.created ? stats.created++ : stats.updated++; return r; };

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

  // (The session's model list is intentionally NOT stored separately — it is
  // derivable from the `model` column of the session's turns.)

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
          mapKey: name,
          value: toText(raw),
        }));
        stats.properties++;
      }
    }
  }

  return stats;
}

/** Read a transcript JSONL file and import every session it contains. */
export async function importTranscriptFile(ds: any, filePath: string) {
  const text = fs.readFileSync(filePath, 'utf8');
  const sessions = parseTranscript(text);
  const results = [];
  for (const session of sessions) {
    results.push(await importSession(ds, session));
  }
  return results;
}

/** Recursively find `*.jsonl` transcript files under a directory. */
export function findTranscriptFiles(dir: string): string[] {
  const out: string[] = [];
  const walk = (d: string) => {
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

export { SOURCE_SYSTEM, TYPE_IDS, ensureTypes };
