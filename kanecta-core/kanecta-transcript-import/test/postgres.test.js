'use strict';

// Portability proof: the same importer produces the same typed-object model on
// Postgres (columns in obj_<typeId> tables) as on the filesystem (inline JSON).
// Requires a live Postgres — SKIPS gracefully when none is reachable, so the
// suite still passes without one (set KANECTA_TEST_PG_URL to point at any pg
// with pgvector, default localhost:45432).

const { test, before, after } = require('node:test');
const assert = require('node:assert');
const crypto = require('crypto');
const { parseTranscript } = require('../src/parse');
const { importSession, SOURCE_SYSTEM, TYPE_IDS } = require('../src/import');

const CONN = process.env.KANECTA_TEST_PG_URL || 'postgres://kanecta:kanecta@localhost:45432/kanecta';
const SCHEMA = `ts_import_${crypto.randomBytes(4).toString('hex')}`;

let Pool, PostgresAdapter, admin, pool, ds, available = false;

const BASE = [
  { type: 'user', uuid: 'u1', timestamp: '2026-06-01T10:00:00Z', sessionId: 's1', cwd: '/p', message: { role: 'user', content: 'Add a feature' } },
  {
    type: 'assistant', uuid: 'a1', timestamp: '2026-06-01T10:00:05Z', sessionId: 's1',
    message: {
      model: 'claude-opus-4-8', role: 'assistant',
      content: [
        { type: 'text', text: 'On it.' },
        { type: 'tool_use', id: 'toolu_1', name: 'Bash', input: { command: 'ls', description: 'list' } },
      ],
      usage: { input_tokens: 1, output_tokens: 2, cache_creation_input_tokens: 0, cache_read_input_tokens: 5 },
    },
  },
  { type: 'user', uuid: 'u2', timestamp: '2026-06-01T10:00:08Z', sessionId: 's1', message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'toolu_1', content: 'file.txt', is_error: false }] } },
];
const jsonl = BASE.map((e) => JSON.stringify(e)).join('\n');

before(async () => {
  try {
    ({ Pool } = require('pg'));
    ({ PostgresAdapter } = require('@kanecta/postgres'));
    admin = new Pool({ connectionString: CONN });
    await admin.query(`CREATE SCHEMA "${SCHEMA}"`);
    pool = new Pool({ connectionString: CONN, options: `-c search_path="${SCHEMA}"` });
    ds = await PostgresAdapter.init(pool, 'test@example.com');
    available = true;
  } catch {
    available = false; // no pg (or no pgvector) — tests below will skip
  }
});

after(async () => {
  if (pool) await pool.end();
  if (admin) {
    await admin.query(`DROP SCHEMA IF EXISTS "${SCHEMA}" CASCADE`);
    await admin.end();
  }
});

test('imports transcripts as typed objects with real columns on Postgres', async (t) => {
  if (!available) return t.skip('no Postgres reachable');

  const [session] = parseTranscript(jsonl);
  const stats = await importSession(ds, session);
  assert.equal(stats.created, 8); // session + model prop + 3 turns + tool-call + 2 arg props
  assert.equal(stats.turns, 3);
  assert.equal(stats.toolCalls, 1);

  // Session is a typed object; the payload comes back from obj_<typeId> columns.
  const sess = await ds.bySource(SOURCE_SYSTEM, 'session:s1');
  assert.equal(sess.type, 'object');
  assert.equal(sess.typeId, TYPE_IDS.session);
  const sp = await ds.readObjectJson(sess.id);
  assert.equal(sp.sessionId, 's1');
  assert.equal(Number(sp.tokensOutput), 2);     // BIGINT comes back as a string
  assert.equal(Number(sp.tokensCacheRead), 5);
  assert.equal(Number(sp.turnCount), 3);

  // Tool call → columns + property children (the variable input map, decomposed).
  const asst = await ds.bySource(SOURCE_SYSTEM, 'turn:a1');
  const toolCalls = (await ds.children(asst.id)).filter((c) => c.typeId === TYPE_IDS.toolCall);
  assert.equal(toolCalls.length, 1);
  const cp = await ds.readObjectJson(toolCalls[0].id);
  assert.equal(cp.name, 'Bash');
  assert.equal(cp.result, 'file.txt');

  const args = (await ds.children(toolCalls[0].id)).filter((c) => c.typeId === TYPE_IDS.property);
  assert.equal(args.length, 2);
  const argMap = {};
  for (const a of args) { const p = await ds.readObjectJson(a.id); argMap[p.name] = p.value; }
  assert.deepEqual(argMap, { command: 'ls', description: 'list' });
});

test('re-import is idempotent on Postgres', async (t) => {
  if (!available) return t.skip('no Postgres reachable');
  const [session] = parseTranscript(jsonl);
  const stats = await importSession(ds, session);
  assert.equal(stats.created, 0);
  assert.equal(stats.updated, 8);
});
