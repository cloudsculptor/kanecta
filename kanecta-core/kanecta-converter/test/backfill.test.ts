// Tests for backfill — idempotent source rows → item upserts, over the real
// discussions shapes. The load-bearing cases are the two production hazards: Gap D
// (preserve a UUID PK as the item id) and Gap C (composite/serial keys → a stable
// surrogate id + a natural idempotency key), plus FK→parentId/relationship.

import { test } from 'node:test';
import assert from 'node:assert';
import { planBackfill } from '../src/index.ts';
import type { SourceTable } from '../src/index.ts';

const threads: SourceTable = {
  name: 'discussions_threads',
  primaryKey: ['id'],
  columns: [
    { name: 'id', sqlType: 'uuid', nullable: false },
    { name: 'name', sqlType: 'text', nullable: false },
    { name: 'archived_at', sqlType: 'timestamptz', nullable: true },
    { name: 'sort_order', sqlType: 'integer', nullable: true },
  ],
};

const messages: SourceTable = {
  name: 'discussions_messages',
  primaryKey: ['id'],
  foreignKeys: [
    { column: 'thread_id', references: { table: 'discussions_threads', column: 'id' } },
    { column: 'parent_message_id', references: { table: 'discussions_messages', column: 'id' } },
  ],
  columns: [
    { name: 'id', sqlType: 'uuid', nullable: false },
    { name: 'thread_id', sqlType: 'uuid', nullable: false },
    { name: 'parent_message_id', sqlType: 'uuid', nullable: true },
    { name: 'content', sqlType: 'text', nullable: false },
  ],
};

const reactions: SourceTable = {
  name: 'discussions_reactions',
  primaryKey: ['message_id', 'user_id', 'emoji'],
  foreignKeys: [{ column: 'message_id', references: { table: 'discussions_messages', column: 'id' } }],
  columns: [
    { name: 'message_id', sqlType: 'uuid', nullable: false },
    { name: 'user_id', sqlType: 'text', nullable: false },
    { name: 'emoji', sqlType: 'text', nullable: false },
  ],
};

test('Gap D: a UUID PK is preserved verbatim as the item id (never re-minted)', () => {
  const plan = planBackfill(threads, [{ id: 'aa000000-0000-4000-8000-000000000001', name: 'General', archived_at: null, sort_order: 1 }], { typeId: 'T', sourceSystem: 'community-hub' });
  const u = plan.upserts[0];
  assert.equal(u.id, 'aa000000-0000-4000-8000-000000000001'); // preserved
  assert.equal(u.sourceExternalId, 'discussions_threads:aa000000-0000-4000-8000-000000000001');
  assert.equal(u.parentId, '00000000-0000-0000-0000-000000000000');
  // id is the item id → NOT an object field; other columns kept (faithful).
  assert.equal('id' in u.objectData, false);
  assert.deepEqual(u.objectData, { name: 'General', archivedAt: null, sortOrder: 1 });
  assert.equal(plan.stats.preservedUuids, 1);
});

test('FK → containment parentId; other FK → a relationship edge; FK columns stay as fields', () => {
  const plan = planBackfill(messages, [
    { id: 'M1', thread_id: 'T1', parent_message_id: null, content: 'Hello' },
    { id: 'M2', thread_id: 'T1', parent_message_id: 'M1', content: 'Reply' },
  ], { typeId: 'Msg', parentColumn: 'thread_id', relationshipTypes: { parent_message_id: 'replyTo' } });

  assert.equal(plan.upserts[0].parentId, 'T1'); // thread_id → parentId
  assert.equal(plan.upserts[1].parentId, 'T1');
  // M1 has a null parent_message_id → no edge; M2 → one replyTo edge.
  assert.deepEqual(plan.relationships, [{ sourceId: 'M2', targetId: 'M1', type: 'replyTo' }]);
  assert.equal(plan.stats.nullFkSkipped, 1);
  // FK columns are still faithful object fields.
  assert.equal(plan.upserts[1].objectData.threadId, 'T1');
  assert.equal(plan.upserts[1].objectData.parentMessageId, 'M1');
});

test('Gap C: a composite PK → a deterministic surrogate id + a natural idempotency key', () => {
  const row = { message_id: 'M1', user_id: 'u-alice', emoji: '👍' };
  const plan = planBackfill(reactions, [row], { typeId: 'Rx', sourceSystem: 'community-hub', parentColumn: 'message_id' });
  const u = plan.upserts[0];
  assert.equal(u.sourceExternalId, 'discussions_reactions:M1|u-alice|👍'); // natural composite key
  assert.match(u.id, /^[0-9a-f-]{36}$/); // a surrogate UUID, not a source id
  assert.equal(u.parentId, 'M1'); // message_id → containment
  assert.equal(plan.stats.surrogateKeys, 1);
});

test('idempotent: re-running the same rows yields identical ids and plan', () => {
  const rows = [{ message_id: 'M1', user_id: 'u-alice', emoji: '👍' }];
  const a = planBackfill(reactions, rows, { typeId: 'Rx', sourceSystem: 'community-hub', parentColumn: 'message_id' });
  const b = planBackfill(reactions, rows, { typeId: 'Rx', sourceSystem: 'community-hub', parentColumn: 'message_id' });
  assert.equal(a.upserts[0].id, b.upserts[0].id);
  assert.deepEqual(a.upserts, b.upserts);
});

test('Gap C serial-PK: flagged in notes (idempotency on a serial is unstable)', () => {
  const fcm: SourceTable = {
    name: 'fcm_tokens',
    primaryKey: ['id'],
    columns: [
      { name: 'id', sqlType: 'integer', nullable: false, default: "nextval('fcm_tokens_id_seq')" },
      { name: 'token', sqlType: 'text', nullable: false },
    ],
  };
  const plan = planBackfill(fcm, [{ id: 5, token: 'abc' }], { typeId: 'F' });
  assert.ok(plan.notes.some((n) => /serial.*natural key.*Gap C/.test(n)));
  // With the natural key supplied, idempotency is stable and the serial id is unused.
  const fixed = planBackfill(fcm, [{ id: 5, token: 'abc' }], { typeId: 'F', idempotencyColumns: ['token'] });
  assert.equal(fixed.upserts[0].sourceExternalId, 'fcm_tokens:abc');
});

test('soft-delete column → native deletedAt, removed from objectData', () => {
  const plan = planBackfill(threads, [{ id: 'T1', name: 'Old', archived_at: '2026-02-01T00:00:00Z', sort_order: 9 }], { typeId: 'T', softDeleteColumn: 'archived_at' });
  const u = plan.upserts[0];
  assert.equal(u.deletedAt, '2026-02-01T00:00:00Z');
  assert.equal('archivedAt' in u.objectData, false);
  assert.equal(plan.stats.softDeleted, 1);
});
