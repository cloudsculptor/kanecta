// Integration tests for the S3 files adapter against a live S3-compatible store
// (the dev MinIO). They run ONLY when KANECTA_TEST_S3_SECRET is set, so CI — which
// has no S3 — skips them cleanly, and no secret is committed. Run locally with:
//
//   KANECTA_TEST_S3_SECRET=<secret> npm test
//
// The other KANECTA_TEST_S3_* vars default to the dev MinIO from
// scripts/setup-local-minio.sh (endpoint :45900, bucket "kanecta").
//
// Runs under vitest (globals: true) — `test` is global.

import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { S3Adapter } from '../src/adapter';

const SECRET = process.env.KANECTA_TEST_S3_SECRET;
const skip = SECRET
  ? false
  : 'set KANECTA_TEST_S3_SECRET (+ optional KANECTA_TEST_S3_*) to run S3 integration tests';

const cfg = {
  endpoint: process.env.KANECTA_TEST_S3_ENDPOINT || 'http://localhost:45900',
  region: process.env.KANECTA_TEST_S3_REGION || 'us-east-1',
  bucket: process.env.KANECTA_TEST_S3_BUCKET || 'kanecta',
  accessKeyId: process.env.KANECTA_TEST_S3_KEY || 'kanecta',
  secretAccessKey: SECRET,
  forcePathStyle: true,
};

const newId = () => crypto.randomUUID();

// ─── Always-on unit checks (no network) ───────────────────────────────────────

test('constructor requires client and bucket', () => {
  assert.throws(() => new S3Adapter({ bucket: 'b' }), /client/);
  assert.throws(() => new S3Adapter({ client: {} }), /bucket/);
});

test('fromConfig requires a bucket', () => {
  assert.throws(() => S3Adapter.fromConfig({}), /bucket/);
});

test('fromConfig builds a usable adapter', () => {
  const a = S3Adapter.fromConfig({ bucket: 'kanecta', region: 'us-east-1' });
  assert.ok(a instanceof S3Adapter);
});

// ─── Live MinIO round-trips ───────────────────────────────────────────────────

test('putFile then getFile round-trips bytes', { skip }, async () => {
  const a = S3Adapter.fromConfig(cfg);
  const itemId = newId();
  await a.putFile(itemId, 'note.txt', Buffer.from('hello kanecta'), { mimeType: 'text/plain' });
  const got = await a.getFile(itemId, 'note.txt');
  assert.ok(got, 'expected bytes back');
  assert.equal(got.toString('utf8'), 'hello kanecta');
  await a.deleteFile(itemId, 'note.txt');
});

test('getFile returns null for a missing object', { skip }, async () => {
  const a = S3Adapter.fromConfig(cfg);
  assert.equal(await a.getFile(newId(), 'nope.txt'), null);
});

test("listFiles returns only this item's files", { skip }, async () => {
  const a = S3Adapter.fromConfig(cfg);
  const itemId = newId();
  const other = newId();
  await a.putFile(itemId, 'a.txt', Buffer.from('a'));
  await a.putFile(itemId, 'b.txt', Buffer.from('b'));
  await a.putFile(other, 'c.txt', Buffer.from('c'));
  try {
    const files = (await a.listFiles(itemId)).sort();
    assert.deepEqual(files, ['a.txt', 'b.txt']);
  } finally {
    await a.deleteFile(itemId, 'a.txt');
    await a.deleteFile(itemId, 'b.txt');
    await a.deleteFile(other, 'c.txt');
  }
});

test('deleteFile removes the object and is idempotent', { skip }, async () => {
  const a = S3Adapter.fromConfig(cfg);
  const itemId = newId();
  await a.putFile(itemId, 'x.txt', Buffer.from('x'));
  await a.deleteFile(itemId, 'x.txt');
  assert.equal(await a.getFile(itemId, 'x.txt'), null);
  await a.deleteFile(itemId, 'x.txt'); // no throw when already gone
});

test('putFile overwrites an existing object', { skip }, async () => {
  const a = S3Adapter.fromConfig(cfg);
  const itemId = newId();
  await a.putFile(itemId, 'v.txt', Buffer.from('v1'));
  await a.putFile(itemId, 'v.txt', Buffer.from('v2'));
  try {
    assert.equal((await a.getFile(itemId, 'v.txt')).toString('utf8'), 'v2');
  } finally {
    await a.deleteFile(itemId, 'v.txt');
  }
});

test('listFiles returns [] for an item with no files', { skip }, async () => {
  const a = S3Adapter.fromConfig(cfg);
  assert.deepEqual(await a.listFiles(newId()), []);
});
