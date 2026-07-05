import { test } from 'node:test';
import assert from 'node:assert';
import os from 'os';
import path from 'path';
import fs from 'fs';
import { Datastore } from '@kanecta/lib';
import { parseTranscript } from '../src/parse.js';
import { importSession, SOURCE_SYSTEM, TYPE_IDS } from '../src/import.js';

function tmpDs() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'kanecta-transcript-'));
  return { ds: Datastore.init(root, 'test@example.com'), root };
}

function makeTranscript(turns: any[]): string {
  return turns.map((t) => JSON.stringify(t)).join('\n');
}

const childrenOfType = async (ds: any, id: string, typeId: string): Promise<any[]> =>
  (await ds.children(id)).filter((c: any) => c.typeId === typeId);

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

// Item count for BASE: session(1) + 3 turns + tool-call(1) + tool-arg property(1)
// = 6. (Models are not stored separately — they are derivable from turn.model.)
const BASE_ITEMS = 6;

test('imports a session as typed objects (session → turn → tool-call), payload in columns', async () => {
  const { ds, root } = tmpDs();
  try {
    const [session] = parseTranscript(makeTranscript(BASE));
    assert.ok(session);
    const stats = await importSession(ds, session);

    assert.equal(stats.turns, 3);
    assert.equal(stats.toolCalls, 1);
    assert.equal(stats.properties, 1); // 1 tool arg
    assert.equal(stats.created, BASE_ITEMS);

    // Session is a typed object; its payload holds the flat columns.
    const sess = await ds.bySource(SOURCE_SYSTEM, 'session:s1');
    assert.ok(sess, 'session item exists');
    assert.equal(sess.type, 'object');
    assert.equal(sess.typeId, TYPE_IDS.session);
    const sp = await ds.readObjectJson(sess.id);
    assert.equal(sp.tokensOutput, 2);
    assert.equal(sp.turnCount, 3);
    assert.equal(sp.sessionId, 's1');

    // The session has no `property` children (models are not stored separately).
    const sessProps = await childrenOfType(ds, sess.id, TYPE_IDS.property);
    assert.equal(sessProps.length, 0);

    // Turns are typed-object children of the session.
    const turns = await childrenOfType(ds, sess.id, TYPE_IDS.turn);
    assert.equal(turns.length, 3);

    // The assistant turn owns the tool-call, with its result merged in.
    const asst = await ds.bySource(SOURCE_SYSTEM, 'turn:a1');
    const toolCalls = await childrenOfType(ds, asst.id, TYPE_IDS.toolCall);
    assert.equal(toolCalls.length, 1);
    const cp = await ds.readObjectJson(toolCalls[0].id);
    assert.equal(cp.name, 'Bash');
    assert.equal(cp.result, 'file.txt');

    // The tool call's argument is a child `property`: the key is item.value,
    // the value is in the payload.
    const args = await childrenOfType(ds, toolCalls[0].id, TYPE_IDS.property);
    assert.equal(args.length, 1);
    assert.equal(args[0].value, 'command'); // item.value = the map key
    assert.deepEqual(await ds.readObjectJson(args[0].id), { value: 'ls' });
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('seeds the four transcript types (idempotently)', async () => {
  const { ds, root } = tmpDs();
  try {
    await importSession(ds, parseTranscript(makeTranscript(BASE))[0]);
    // A second import must not re-create the types.
    await importSession(ds, parseTranscript(makeTranscript(BASE))[0]);
    for (const [name, id] of Object.entries(TYPE_IDS)) {
      const t = await ds.get(id);
      assert.ok(t, `type ${name} exists`);
      assert.equal(t.type, 'type');
      // resolveTypeId maps the title back to our fixed id — proving no duplicate
      // type was created under a fresh id on the second import.
      const r = await ds.resolveTypeId(t.value);
      assert.equal(r.id, id, `type ${name} resolves to its fixed id`);
    }
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('re-importing the identical transcript creates nothing new (idempotent)', async () => {
  const { ds, root } = tmpDs();
  try {
    const [session] = parseTranscript(makeTranscript(BASE));
    assert.ok(session);
    await importSession(ds, session);
    const before = (await ds.loadAll()).length;

    const stats2 = await importSession(ds, session);
    assert.equal(stats2.created, 0);
    assert.equal(stats2.updated, BASE_ITEMS);

    const after = (await ds.loadAll()).length;
    assert.equal(after, before, 'no duplicate items on re-import');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('re-importing a grown transcript appends only the new items', async () => {
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

    // Three new items: the new turn + its tool call + its one arg property.
    assert.equal(stats.created, 3);
    const after = (await ds.loadAll()).length;
    assert.equal(after, before + 3);

    // Session token totals are refreshed to include the new turn.
    const sess = await ds.bySource(SOURCE_SYSTEM, 'session:s1');
    const payload = await ds.readObjectJson(sess.id);
    assert.equal(payload.tokensOutput, 6); // 2 + 4
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('stores large text in full (no truncation, no offload)', async () => {
  const { ds, root } = tmpDs();
  try {
    const big = 'x'.repeat(200000);
    const evts = [
      { type: 'user', uuid: 'u1', timestamp: '2026-06-01T10:00:00Z', sessionId: 'big', message: { role: 'user', content: big } },
    ];
    const [session] = parseTranscript(makeTranscript(evts));
    assert.ok(session);
    await importSession(ds, session);

    const turn = await ds.bySource(SOURCE_SYSTEM, 'turn:u1');
    const payload = await ds.readObjectJson(turn.id);
    assert.equal(payload.textLength, 200000);
    assert.equal(payload.text.length, 200000);
    assert.equal(payload.text, big);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
