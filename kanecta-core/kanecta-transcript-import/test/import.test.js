'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const os = require('os');
const path = require('path');
const fs = require('fs');
const { Datastore } = require('@kanecta/lib');
const { parseTranscript } = require('../src/parse');
const { importSession, SOURCE_SYSTEM } = require('../src/import');

function tmpDs() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'kanecta-transcript-'));
  return { ds: Datastore.init(root, 'test@example.com'), root };
}

function makeTranscript(turns) {
  return turns.map((t) => JSON.stringify(t)).join('\n');
}

const BASE = [
  { type: 'user', uuid: 'u1', timestamp: '2026-06-01T10:00:00Z', sessionId: 's1', cwd: '/p', message: { role: 'user', content: 'Add a feature' } },
  {
    type: 'assistant', uuid: 'a1', timestamp: '2026-06-01T10:00:05Z', sessionId: 's1',
    message: {
      model: 'claude-opus-4-8', role: 'assistant',
      content: [
        { type: 'text', text: 'On it.' },
        { type: 'tool_use', id: 'toolu_1', name: 'Bash', input: { command: 'ls' } },
      ],
      usage: { input_tokens: 1, output_tokens: 2, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 },
    },
  },
  { type: 'user', uuid: 'u2', timestamp: '2026-06-01T10:00:08Z', sessionId: 's1', message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'toolu_1', content: 'file.txt', is_error: false }] } },
];

test('imports a session as session → turn → tool-call items', async () => {
  const { ds, root } = tmpDs();
  try {
    const [session] = parseTranscript(makeTranscript(BASE));
    const stats = await importSession(ds, session);

    assert.equal(stats.turns, 3);
    assert.equal(stats.toolCalls, 1);
    assert.equal(stats.created, 5); // 1 session + 3 turns + 1 tool call

    // Session item, found by its external key.
    const sess = await ds.bySource(SOURCE_SYSTEM, 'session:s1');
    assert.ok(sess, 'session item exists');
    assert.equal(sess.type, 'claude-session');
    const sessPayload = await ds.readObjectJson(sess.id);
    assert.equal(sessPayload.tokens.output, 2);
    assert.equal(sessPayload.turnCount, 3);

    // Turns are children of the session. (children() also surfaces the object
    // payload's fields as synthetic nodes — the documented spec gap — so filter
    // to the real turn items by type, as consumers do.)
    const turns = (await ds.children(sess.id)).filter((c) => c.type === 'claude-turn');
    assert.equal(turns.length, 3);

    // The assistant turn owns the tool-call child, with its result merged in.
    const asst = await ds.bySource(SOURCE_SYSTEM, 'turn:a1');
    const toolCalls = (await ds.children(asst.id)).filter((c) => c.type === 'claude-tool-call');
    assert.equal(toolCalls.length, 1);
    const callPayload = await ds.readObjectJson(toolCalls[0].id);
    assert.equal(callPayload.name, 'Bash');
    assert.equal(callPayload.result, 'file.txt');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('re-importing the identical transcript creates nothing new (idempotent)', async () => {
  const { ds, root } = tmpDs();
  try {
    const [session] = parseTranscript(makeTranscript(BASE));
    await importSession(ds, session);
    const before = (await ds.loadAll()).length;

    const stats2 = await importSession(ds, session);
    assert.equal(stats2.created, 0);
    assert.equal(stats2.updated, 5);

    const after = (await ds.loadAll()).length;
    assert.equal(after, before, 'no duplicate items on re-import');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('re-importing a grown transcript appends only the new turns', async () => {
  const { ds, root } = tmpDs();
  try {
    await importSession(ds, parseTranscript(makeTranscript(BASE))[0]);
    const before = (await ds.loadAll()).length;

    // The session continues: one more assistant turn with a new tool call.
    const grown = [
      ...BASE,
      {
        type: 'assistant', uuid: 'a2', timestamp: '2026-06-01T10:01:00Z', sessionId: 's1',
        message: {
          model: 'claude-opus-4-8', role: 'assistant',
          content: [{ type: 'tool_use', id: 'toolu_2', name: 'Read', input: { path: 'file.txt' } }],
          usage: { input_tokens: 3, output_tokens: 4, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 },
        },
      },
    ];
    const stats = await importSession(ds, parseTranscript(makeTranscript(grown))[0]);

    // Exactly two new items: the new turn + its tool call. Everything else updates.
    assert.equal(stats.created, 2);
    const after = (await ds.loadAll()).length;
    assert.equal(after, before + 2);

    // Session token totals are refreshed to include the new turn.
    const sess = await ds.bySource(SOURCE_SYSTEM, 'session:s1');
    const payload = await ds.readObjectJson(sess.id);
    assert.equal(payload.tokens.output, 6); // 2 + 4
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('caps oversized text and marks it truncated', async () => {
  const { ds, root } = tmpDs();
  try {
    const big = 'x'.repeat(500);
    const evts = [
      { type: 'user', uuid: 'u1', timestamp: '2026-06-01T10:00:00Z', sessionId: 'big', message: { role: 'user', content: big } },
    ];
    const [session] = parseTranscript(makeTranscript(evts));
    await importSession(ds, session, { maxTextChars: 100 });

    const turn = await ds.bySource(SOURCE_SYSTEM, 'turn:u1');
    const payload = await ds.readObjectJson(turn.id);
    assert.equal(payload.textTruncated, true);
    assert.equal(payload.textLength, 500);
    assert.ok(payload.text.length < 200);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
