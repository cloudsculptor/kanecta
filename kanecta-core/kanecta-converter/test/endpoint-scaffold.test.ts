// Tests for endpoint-scaffold (Gate 2), over the REAL community-hub discussions
// routes — the interesting cases are the determinism-boundary calls: a GET that
// looks like a pure read but secretly seeds state, a derived nested projection, a
// write, and a Keycloak proxy that isn't item-CRUD at all.

import { test } from 'node:test';
import assert from 'node:assert';
import { scaffoldEndpoint, scaffoldEndpoints, pathParams } from '../src/index.ts';
import type { SourceEndpoint } from '../src/index.ts';

test('pathParams extracts route params in order', () => {
  assert.deepEqual(pathParams('/threads/:threadId/messages/:msgId'), ['threadId', 'msgId']);
  assert.deepEqual(pathParams('/threads'), []);
});

test('a pure single-type read → a query item with returnType set', () => {
  const ep: SourceEndpoint = { method: 'GET', path: '/notices', sql: 'SELECT * FROM notices ORDER BY created_at DESC', returnTypeValue: 'notices' };
  const r = scaffoldEndpoint(ep);
  assert.equal(r.classification, 'query');
  assert.equal(r.determinism, 'deterministic');
  assert.equal(r.item.item.type, 'query');
  assert.equal(r.item.payload.language, 'sql');
  assert.ok(r.item.payload.returnType); // single-type → returnType present
  assert.equal(r.punchList, undefined);
});

test('a derived/assembled read → a query with returnType null and its path param', () => {
  // GET /threads/:id/messages → Message[] with files[] + reply_count (a projection).
  const ep: SourceEndpoint = { method: 'GET', path: '/threads/:id/messages', derived: true, description: 'messages + files + reply_count' };
  const r = scaffoldEndpoint(ep);
  assert.equal(r.classification, 'query');
  assert.equal(r.determinism, 'deterministic');
  assert.equal(r.item.payload.returnType, null); // derived shape
  assert.deepEqual(r.item.payload.params.map((p: any) => p.name), ['id']);
});

test('GET /threads is NOT a pure read — it seeds thread_reads → a function + punch-list', () => {
  const ep: SourceEndpoint = { method: 'GET', path: '/threads', sideEffects: ['seeds thread_reads on first call'] };
  const r = scaffoldEndpoint(ep);
  assert.equal(r.classification, 'function');
  assert.equal(r.determinism, 'needs-judgment');
  assert.equal(r.item.item.type, 'function');
  assert.equal(r.item.payload.scaffold, true);
  assert.match(r.punchList!, /seeds thread_reads/);
});

test('a write → a function + punch-list', () => {
  const ep: SourceEndpoint = { method: 'POST', path: '/threads', sideEffects: ['emit thread:new', 'FCM broadcast'] };
  const r = scaffoldEndpoint(ep);
  assert.equal(r.classification, 'function');
  assert.match(r.reason, /POST write/);
  assert.match(r.punchList!, /emit thread:new/);
});

test('a non-data integration → an app-shim function (never item-CRUD)', () => {
  const ep: SourceEndpoint = { method: 'GET', path: '/users', integration: 'keycloak', description: 'list realm users with team role' };
  const r = scaffoldEndpoint(ep);
  assert.equal(r.classification, 'function');
  assert.match(r.reason, /non-data integration \(keycloak\)/);
  assert.match(r.punchList!, /app-shim to keycloak/);
});

test('same endpoint → same deterministic id (stable re-runs)', () => {
  const ep: SourceEndpoint = { method: 'GET', path: '/notices' };
  assert.equal(scaffoldEndpoint(ep).item.item.id, scaffoldEndpoint(ep).item.item.id);
});

test('scaffoldEndpoints rolls up the determinism split + a single punch-list', () => {
  const routes: SourceEndpoint[] = [
    { method: 'GET', path: '/notices', returnTypeValue: 'notices' },
    { method: 'GET', path: '/threads/:id/messages', derived: true },
    { method: 'GET', path: '/threads', sideEffects: ['seeds thread_reads'] },
    { method: 'POST', path: '/threads', sideEffects: ['emit thread:new'] },
    { method: 'GET', path: '/users', integration: 'keycloak' },
  ];
  const s = scaffoldEndpoints(routes);
  assert.equal(s.counts.query, 2);
  assert.equal(s.counts.function, 3);
  assert.equal(s.counts.deterministic, 2);
  assert.equal(s.counts.needsJudgment, 3);
  assert.equal(s.punchList.length, 3);
});
