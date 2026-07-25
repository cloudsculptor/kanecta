// Tests for response-diff (Gate 2's byte-for-byte JSON parity check), over the
// real community-hub discussions response shapes (snake_case, nested files +
// reply_count, the grouped reactions map, and the deliberately-string `count`).

import { test } from 'node:test';
import assert from 'node:assert';
import { diffResponses } from '../src/index.ts';

// A GET /threads element per the discussions contract.
const oldThread = {
  id: 'aa000000-0000-4000-8000-000000000001',
  name: 'General',
  description: 'Town chatter',
  created_by_name: 'Alice',
  created_by_user_id: 'u-alice',
  created_at: '2026-01-01T00:00:00Z',
  has_unread: true,
  is_notifications_enabled: false,
};

test('identical responses → parity', () => {
  const report = diffResponses([oldThread], [structuredClone(oldThread)]);
  assert.equal(report.verdict, 'parity');
  assert.deepEqual(report.divergences, []);
  assert.ok(report.counts.matched > 0);
});

test('a missing field is a divergence (fidelity loss)', () => {
  const served = structuredClone(oldThread) as any;
  delete served.has_unread;
  const report = diffResponses([oldThread], [served]);
  assert.equal(report.verdict, 'divergent');
  assert.ok(report.divergences.some((d) => d.kind === 'missing' && d.path === '[0].has_unread'));
});

test('an extra field is a divergence (contract drift)', () => {
  const served = { ...structuredClone(oldThread), internal_rank: 7 };
  const report = diffResponses([oldThread], [served]);
  assert.equal(report.verdict, 'divergent');
  assert.ok(report.divergences.some((d) => d.kind === 'extra' && d.path === '[0].internal_rank'));
});

test('string "3" is NOT the number 3 — the reactions `count` gotcha is caught', () => {
  // GET /threads/:id/reactions → Record<messageId, Reaction[]>; count is a STRING.
  const oldMap = { 'msg-1': [{ emoji: '👍', count: '3', user_ids: ['a', 'b', 'c'], user_names: ['A', 'B', 'C'] }] };
  const servedMap = { 'msg-1': [{ emoji: '👍', count: 3, user_ids: ['a', 'b', 'c'], user_names: ['A', 'B', 'C'] }] };
  const report = diffResponses(oldMap, servedMap);
  assert.equal(report.verdict, 'divergent');
  const hit = report.divergences.find((d) => d.path === 'msg-1[0].count');
  assert.equal(hit?.kind, 'type-mismatch');
  assert.match(hit!.detail!, /string ≠ number/);
});

test('array length + element field diffs both surface', () => {
  const report = diffResponses([oldThread, oldThread], [{ ...oldThread, name: 'Renamed' }]);
  assert.equal(report.verdict, 'divergent');
  assert.ok(report.divergences.some((d) => d.kind === 'array-length' && d.detail === '2 ≠ 1'));
  assert.ok(report.divergences.some((d) => d.kind === 'value-mismatch' && d.path === '[0].name'));
});

test('keyRenames lets a snake→camel compat surface read as parity', () => {
  const served = {
    id: oldThread.id, name: oldThread.name, description: oldThread.description,
    createdByName: 'Alice', createdByUserId: 'u-alice', createdAt: '2026-01-01T00:00:00Z',
    hasUnread: true, isNotificationsEnabled: false,
  };
  const report = diffResponses([oldThread], [served], {
    keyRenames: {
      created_by_name: 'createdByName', created_by_user_id: 'createdByUserId',
      created_at: 'createdAt', has_unread: 'hasUnread', is_notifications_enabled: 'isNotificationsEnabled',
    },
  });
  assert.equal(report.verdict, 'parity');
});

test('nullEqualsAbsent tolerates omitted nulls; ignoreKeys drops a volatile field (and reports it)', () => {
  const old = { id: 'f1', name: 'a.png', url: 'https://cdn/x?sig=OLD', edited_at: null };
  const served = { id: 'f1', name: 'a.png', url: 'https://cdn/x?sig=NEW' }; // edited_at omitted, url re-signed
  const report = diffResponses(old, served, { nullEqualsAbsent: true, ignoreKeys: ['url'] });
  assert.equal(report.verdict, 'parity');
  assert.deepEqual(report.ignoredKeys, ['url']);
});

test('knownNuanceKeys downgrades a documented value delta to a nuance, not a divergence', () => {
  const old = { id: 'm1', content: 'hi', url: 'http://old/storage/x' };
  const served = { id: 'm1', content: 'hi', url: 'https://spaces/x' };
  const report = diffResponses(old, served, { knownNuanceKeys: ['url'] });
  assert.equal(report.verdict, 'parity');
  assert.equal(report.nuances.length, 1);
  assert.equal(report.nuances[0].kind, 'known-nuance');
});

test('unorderedArrayPaths compares an array as a multiset', () => {
  const old = { user_ids: ['a', 'b', 'c'] };
  const served = { user_ids: ['c', 'a', 'b'] };
  assert.equal(diffResponses(old, served).verdict, 'divergent'); // ordered by default
  assert.equal(diffResponses(old, served, { unorderedArrayPaths: ['user_ids'] }).verdict, 'parity');
});
