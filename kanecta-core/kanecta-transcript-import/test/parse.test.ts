import { test } from 'node:test';
import assert from 'node:assert';
import { parseTranscript, parseJsonl } from '../src/parse.js';

// A small but representative transcript: a user prompt, an assistant turn that
// makes a tool call, and a following user turn carrying the tool result.
const SAMPLE = [
  {
    type: 'user', uuid: 'u1', parentUuid: null, timestamp: '2026-06-01T10:00:00.000Z',
    sessionId: 'sess-1', cwd: '/home/dev/proj', gitBranch: 'main', version: '2.0.0',
    message: { role: 'user', content: 'Please run the tests' },
  },
  {
    type: 'assistant', uuid: 'a1', parentUuid: 'u1', timestamp: '2026-06-01T10:00:05.000Z',
    sessionId: 'sess-1',
    message: {
      model: 'claude-opus-4-8', id: 'msg_1', role: 'assistant',
      content: [
        { type: 'text', text: 'Sure, running them now.' },
        { type: 'tool_use', id: 'toolu_1', name: 'Bash', input: { command: 'npm test' } },
      ],
      usage: { input_tokens: 10, output_tokens: 20, cache_creation_input_tokens: 5, cache_read_input_tokens: 100 },
    },
  },
  {
    type: 'user', uuid: 'u2', parentUuid: 'a1', timestamp: '2026-06-01T10:00:09.000Z',
    sessionId: 'sess-1',
    message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'toolu_1', content: 'All tests passed', is_error: false }] },
  },
].map((e) => JSON.stringify(e)).join('\n');

test('parseJsonl skips blank and corrupt lines', () => {
  const events = parseJsonl('{"a":1}\n\n  \nnot json\n{"b":2}\n');
  assert.deepEqual(events, [{ a: 1 }, { b: 2 }]);
});

test('parses a session with turns, tokens and time bounds', () => {
  const [s] = parseTranscript(SAMPLE);
  assert.ok(s);
  assert.equal(s.sessionId, 'sess-1');
  assert.equal(s.cwd, '/home/dev/proj');
  assert.equal(s.gitBranch, 'main');
  assert.equal(s.version, '2.0.0');
  assert.equal(s.startedAt, '2026-06-01T10:00:00.000Z');
  assert.equal(s.endedAt, '2026-06-01T10:00:09.000Z');
  assert.deepEqual(s.models, ['claude-opus-4-8']);
  assert.deepEqual(s.tokens, { input: 10, output: 20, cacheCreation: 5, cacheRead: 100 });
  assert.equal(s.turnCount, 3);
  assert.equal(s.toolCallCount, 1);
});

test('assistant text and tool_use are captured on the turn', () => {
  const [s] = parseTranscript(SAMPLE);
  assert.ok(s);
  const asst = s.turns.find((t) => t.uuid === 'a1');
  assert.ok(asst);
  assert.equal(asst.kind, 'assistant');
  assert.equal(asst.text, 'Sure, running them now.');
  assert.equal(asst.model, 'claude-opus-4-8');
  assert.equal(asst.toolCalls.length, 1);
  assert.equal(asst.toolCalls[0].name, 'Bash');
  assert.deepEqual(asst.toolCalls[0].input, { command: 'npm test' });
});

test('a tool_result in a later turn is matched back onto its tool_use', () => {
  const [s] = parseTranscript(SAMPLE);
  assert.ok(s);
  const asst = s.turns.find((t) => t.uuid === 'a1');
  assert.ok(asst);
  const call = asst.toolCalls[0];
  assert.equal(call.result, 'All tests passed');
  assert.equal(call.isError, false);
});

test('a plain user prompt becomes a text turn with no tool calls', () => {
  const [s] = parseTranscript(SAMPLE);
  assert.ok(s);
  const u1 = s.turns.find((t) => t.uuid === 'u1');
  assert.ok(u1);
  assert.equal(u1.kind, 'user');
  assert.equal(u1.text, 'Please run the tests');
  assert.equal(u1.toolCalls.length, 0);
});

test('non-turn events still extend the session time window', () => {
  const jsonl = [
    JSON.stringify({ type: 'system', timestamp: '2026-06-01T09:59:00.000Z', sessionId: 's' }),
    JSON.stringify({ type: 'user', uuid: 'u', timestamp: '2026-06-01T10:00:00.000Z', sessionId: 's', message: { role: 'user', content: 'hi' } }),
    JSON.stringify({ type: 'attachment', timestamp: '2026-06-01T10:05:00.000Z', sessionId: 's' }),
  ].join('\n');
  const [s] = parseTranscript(jsonl);
  assert.ok(s);
  assert.equal(s.startedAt, '2026-06-01T09:59:00.000Z');
  assert.equal(s.endedAt, '2026-06-01T10:05:00.000Z');
  assert.equal(s.turnCount, 1); // only the user turn
});

test('merges split lines that share a uuid; counts usage once', () => {
  // Claude Code writes one logical assistant turn as several lines sharing a
  // uuid + message.id, each repeating the SAME usage. thinking on one line, text
  // + tool_use on the next.
  const usage = { input_tokens: 100, output_tokens: 50, cache_creation_input_tokens: 0, cache_read_input_tokens: 200 };
  const jsonl = [
    { type: 'assistant', uuid: 'a1', timestamp: '2026-06-01T10:00:00Z', sessionId: 's', message: { model: 'm', id: 'msg1', content: [{ type: 'text', text: 'Thinking...' }], usage } },
    { type: 'assistant', uuid: 'a1', timestamp: '2026-06-01T10:00:00Z', sessionId: 's', message: { model: 'm', id: 'msg1', content: [{ type: 'text', text: 'Done.' }, { type: 'tool_use', id: 't1', name: 'Bash', input: {} }], usage } },
  ].map((e) => JSON.stringify(e)).join('\n');

  const [s] = parseTranscript(jsonl);
  assert.ok(s);
  assert.equal(s.turnCount, 1, 'split lines collapse into one turn');
  assert.equal(s.toolCallCount, 1);
  // Usage counted once, not doubled.
  assert.deepEqual(s.tokens, { input: 100, output: 50, cacheCreation: 0, cacheRead: 200 });
  const [turn] = s.turns;
  assert.ok(turn);
  assert.equal(turn.text, 'Thinking...\nDone.');
  assert.equal(turn.toolCalls.length, 1);
});

test('deduplicates identical repeated lines (no text or token doubling)', () => {
  const usage = { input_tokens: 10, output_tokens: 20 };
  const line = { type: 'assistant', uuid: 'dup', timestamp: '2026-06-01T10:00:00Z', sessionId: 's', message: { model: 'm', id: 'x', content: [{ type: 'text', text: 'hi' }], usage } };
  const jsonl = [line, line].map((e) => JSON.stringify(e)).join('\n');
  const [s] = parseTranscript(jsonl);
  assert.ok(s);
  assert.equal(s.turnCount, 1);
  assert.equal(s.tokens.output, 20);
  assert.equal(s.turns[0].text, 'hi');
});

test('events are grouped into one entry per sessionId', () => {
  const jsonl = [
    JSON.stringify({ type: 'user', uuid: 'a', timestamp: '2026-06-01T10:00:00Z', sessionId: 'A', message: { role: 'user', content: 'x' } }),
    JSON.stringify({ type: 'user', uuid: 'b', timestamp: '2026-06-01T10:00:00Z', sessionId: 'B', message: { role: 'user', content: 'y' } }),
  ].join('\n');
  const sessions = parseTranscript(jsonl);
  assert.equal(sessions.length, 2);
  assert.deepEqual(sessions.map((s) => s.sessionId).sort(), ['A', 'B']);
});
