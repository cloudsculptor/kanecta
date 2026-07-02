'use strict';

/**
 * Parse a Claude Code session transcript (JSONL) into a normalised, storage-
 * agnostic shape. Pure: no filesystem, no datastore — text in, structure out, so
 * it is trivially unit-testable and reusable by any importer.
 *
 * A transcript is one JSON object per line. The events we model:
 *
 *   { type: 'user',      uuid, parentUuid, timestamp, sessionId, cwd, gitBranch,
 *     version, isSidechain, agentId, message: { role, content } }
 *   { type: 'assistant', ..., message: { model, id, content, usage } }
 *
 * `content` is a string (a plain user prompt) or an array of blocks:
 *   { type: 'text', text }
 *   { type: 'tool_use', id, name, input }          (assistant turns)
 *   { type: 'tool_result', tool_use_id, content, is_error }  (user turns)
 *
 * Other line types (attachment, queue-operation, system, …) carry no turn but
 * still bound the session's time window.
 *
 * Output — one entry per distinct sessionId (normally one per file):
 *
 *   {
 *     sessionId, cwd, gitBranch, version,
 *     startedAt, endedAt,
 *     models: string[],                 // distinct assistant models, in first-seen order
 *     tokens: { input, output, cacheCreation, cacheRead },  // summed over assistant turns
 *     turnCount, toolCallCount,
 *     turns: [{
 *       uuid, kind: 'user'|'assistant', timestamp, parentUuid, isSidechain, agentId,
 *       model, usage, text, toolCalls: [{ toolUseId, name, input, result, isError }]
 *     }]
 *   }
 *
 * tool_result blocks are matched back to their tool_use by id (they arrive in a
 * later user turn), so each toolCall carries its own result.
 */

/** Parse JSONL text into an array of event objects, skipping blank/invalid lines. */
function parseJsonl(text) {
  const events = [];
  for (const line of String(text).split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      events.push(JSON.parse(trimmed));
    } catch {
      // A truncated final line (session still being written) or corrupt line is
      // skipped rather than aborting the whole import.
    }
  }
  return events;
}

function blocksOf(event) {
  const content = event?.message?.content;
  if (Array.isArray(content)) return content;
  if (typeof content === 'string') return [{ type: 'text', text: content }];
  return [];
}

function textOf(event) {
  return blocksOf(event)
    .filter((b) => b && b.type === 'text' && typeof b.text === 'string')
    .map((b) => b.text)
    .join('\n')
    .trim();
}

function usageOf(event) {
  const u = event?.message?.usage;
  if (!u || typeof u !== 'object') return null;
  return {
    input: u.input_tokens ?? 0,
    output: u.output_tokens ?? 0,
    cacheCreation: u.cache_creation_input_tokens ?? 0,
    cacheRead: u.cache_read_input_tokens ?? 0,
  };
}

/**
 * Group a flat event list into sessions. Returns an array (normally length 1).
 * Events without a `sessionId` are attributed to the first session seen so a
 * stray line never spawns a phantom session.
 *
 * IMPORTANT: Claude Code splits one logical turn across several JSONL lines that
 * share the same `uuid` and `message.id` — e.g. a thinking block, a text block
 * and a tool_use block on separate lines, each carrying the SAME `usage`. We must
 * therefore MERGE occurrences by uuid (unioning content + tool calls) and count
 * `usage` exactly ONCE per uuid — otherwise both tokens and text double-count.
 */
function groupSessions(events) {
  const sessions = new Map();
  let firstSessionId = null;

  // Collect tool results across the whole stream first, keyed by tool_use_id, so
  // a tool_use can be paired with its (later) result regardless of order.
  const resultsByToolId = new Map();
  for (const ev of events) {
    for (const b of blocksOf(ev)) {
      if (b && b.type === 'tool_result' && b.tool_use_id) {
        const content = typeof b.content === 'string'
          ? b.content
          : JSON.stringify(b.content);
        resultsByToolId.set(b.tool_use_id, { content, isError: Boolean(b.is_error) });
      }
    }
  }

  const ensure = (sid, ev) => {
    if (!sessions.has(sid)) {
      sessions.set(sid, {
        sessionId: sid,
        cwd: ev.cwd ?? null,
        gitBranch: ev.gitBranch ?? null,
        version: ev.version ?? null,
        startedAt: null,
        endedAt: null,
        models: [],
        tokens: { input: 0, output: 0, cacheCreation: 0, cacheRead: 0 },
        turnCount: 0,
        toolCallCount: 0,
        turns: [],
        _byUuid: new Map(),   // uuid → turn (for merging split lines)
        _seenUsage: new Set(), // uuids whose usage has already been counted
        _noId: 0,             // counter for turns that lack a uuid
      });
    }
    return sessions.get(sid);
  };

  for (const ev of events) {
    const sid = ev.sessionId ?? firstSessionId;
    if (sid == null) continue; // no session context at all — cannot attribute
    if (firstSessionId == null) firstSessionId = sid;

    const s = ensure(sid, ev);

    // Time bounds from every event, not just turns.
    if (ev.timestamp) {
      if (!s.startedAt || ev.timestamp < s.startedAt) s.startedAt = ev.timestamp;
      if (!s.endedAt || ev.timestamp > s.endedAt) s.endedAt = ev.timestamp;
    }

    if (ev.type !== 'user' && ev.type !== 'assistant') continue;

    const model = ev.message?.model ?? null;
    if (model && !s.models.includes(model)) s.models.push(model);

    // Locate-or-create the turn for this uuid (split lines merge into one).
    const uuid = ev.uuid ?? null;
    const key = uuid ?? `__noid:${s._noId++}`;
    let turn = s._byUuid.get(key);
    if (!turn) {
      turn = {
        uuid,
        kind: ev.type,
        timestamp: ev.timestamp ?? null,
        parentUuid: ev.parentUuid ?? null,
        isSidechain: Boolean(ev.isSidechain),
        agentId: ev.agentId ?? null,
        model,
        usage: null,
        text: '',
        toolCalls: [],
        _seenText: new Set(),
        _seenTool: new Set(),
      };
      s._byUuid.set(key, turn);
      s.turns.push(turn);
    }

    // Count usage exactly once per uuid.
    const usage = usageOf(ev);
    if (usage && !s._seenUsage.has(key)) {
      s._seenUsage.add(key);
      turn.usage = usage;
      s.tokens.input += usage.input;
      s.tokens.output += usage.output;
      s.tokens.cacheCreation += usage.cacheCreation;
      s.tokens.cacheRead += usage.cacheRead;
    }

    // Merge in this line's text (dedup identical fragments).
    const text = textOf(ev);
    if (text && !turn._seenText.has(text)) {
      turn._seenText.add(text);
      turn.text = turn.text ? `${turn.text}\n${text}` : text;
    }

    // Merge in this line's tool calls (dedup by tool_use id).
    for (const b of blocksOf(ev)) {
      if (!b || b.type !== 'tool_use') continue;
      if (b.id && turn._seenTool.has(b.id)) continue;
      if (b.id) turn._seenTool.add(b.id);
      turn.toolCalls.push({
        toolUseId: b.id ?? null,
        name: b.name ?? null,
        input: b.input ?? null,
        result: b.id && resultsByToolId.has(b.id) ? resultsByToolId.get(b.id).content : null,
        isError: b.id && resultsByToolId.has(b.id) ? resultsByToolId.get(b.id).isError : null,
      });
    }
  }

  // Finalise counts and strip internal bookkeeping.
  const out = [];
  for (const s of sessions.values()) {
    s.turnCount = s.turns.length;
    s.toolCallCount = s.turns.reduce((n, t) => n + t.toolCalls.length, 0);
    for (const t of s.turns) { delete t._seenText; delete t._seenTool; }
    delete s._byUuid; delete s._seenUsage; delete s._noId;
    out.push(s);
  }
  return out;
}

/** Parse transcript JSONL text into normalised session(s). */
function parseTranscript(text) {
  return groupSessions(parseJsonl(text));
}

module.exports = { parseTranscript, parseJsonl, groupSessions };
