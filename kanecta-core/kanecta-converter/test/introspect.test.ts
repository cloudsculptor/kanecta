// Tests for the introspect tool, over real community-hub-shaped source tables
// (a UUID-PK table, a composite-PK table, and an FK reference). The final test
// loops the generated type item through @kanecta/schema-compiler to prove it
// actually projects to a real obj_ table — closing introspect → type item → DDL.

import { test } from 'node:test';
import assert from 'node:assert';
import { deriveSqlSchema } from '@kanecta/schema-compiler';
import { introspect } from '../src/index.ts';
import type { SourceTable } from '../src/index.ts';

const threads: SourceTable = {
  name: 'discussions_threads',
  primaryKey: ['id'],
  columns: [
    { name: 'id', sqlType: 'uuid', nullable: false, default: 'gen_random_uuid()' },
    { name: 'name', sqlType: 'text', nullable: false },
    { name: 'description', sqlType: 'text', nullable: true },
    { name: 'created_by_user_id', sqlType: 'text', nullable: true },
    { name: 'created_by_name', sqlType: 'text', nullable: true },
    { name: 'created_at', sqlType: 'timestamptz', nullable: true },
    { name: 'archived_at', sqlType: 'timestamptz', nullable: true },
    { name: 'latest_message_at', sqlType: 'timestamptz', nullable: true },
    { name: 'sort_order', sqlType: 'integer', nullable: true },
  ],
  indexes: [{ columns: ['sort_order', 'name'] }],
};

const reactions: SourceTable = {
  name: 'discussions_reactions',
  primaryKey: ['message_id', 'user_id', 'emoji'],
  foreignKeys: [{ column: 'message_id', references: { table: 'discussions_messages', column: 'id' } }],
  columns: [
    { name: 'message_id', sqlType: 'uuid', nullable: false },
    { name: 'user_id', sqlType: 'varchar', nullable: false },
    { name: 'emoji', sqlType: 'text', nullable: false },
    { name: 'user_name', sqlType: 'varchar', nullable: true },
    { name: 'created_at', sqlType: 'timestamptz', nullable: true },
  ],
};

test('UUID-PK table: id becomes the item id, columns become camelCase properties', () => {
  const { typeItem, report } = introspect(threads);
  assert.equal(report.typeName, 'DiscussionsThreads');
  assert.equal(report.typeValue, 'discussions-threads');
  // Seam 1: the UUID PK is the item id, not an obj_ property.
  assert.ok(!report.propertiesEmitted.includes('id'));
  assert.ok(report.seams.some((s) => s.kind === 'id-to-item-id'));
  // camelCase properties.
  assert.ok(report.propertiesEmitted.includes('createdByUserId'));
  assert.ok(report.propertiesEmitted.includes('latestMessageAt'));
  const props = typeItem.payload.jsonSchema.properties;
  assert.equal(props.createdByUserId.type, 'string');
  assert.equal(props.sortOrder.type, 'integer');
  assert.equal(props.createdAt.format, 'date-time');
  // NOT NULL → required.
  assert.ok(typeItem.payload.jsonSchema.required.includes('name'));
  assert.ok(!typeItem.payload.jsonSchema.required.includes('description'));
  // Soft-delete column stored but hidden from GraphQL.
  assert.deepEqual(props.archivedAt['x-graphql'], { expose: false });
  // Index transcribed (Seam 5).
  assert.deepEqual(typeItem.payload.indexes[0], { fields: ['sortOrder', 'name'] });
  // Non-deterministic seed UUID default flagged (Gap D).
  assert.ok(report.seams.some((s) => s.kind === 'non-deterministic-seed-uuid'));
});

test('composite-PK table: surrogate item_id + a UNIQUE index (Seam 2)', () => {
  const { typeItem, report } = introspect(reactions);
  assert.ok(report.seams.some((s) => s.kind === 'composite-pk-surrogate'));
  // PK columns are kept as properties.
  for (const p of ['messageId', 'userId', 'emoji']) assert.ok(report.propertiesEmitted.includes(p));
  // A UNIQUE index reproduces the old composite-PK guarantee.
  const uniq = typeItem.payload.indexes.find((i: any) => i.unique);
  assert.deepEqual(uniq, { fields: ['messageId', 'userId', 'emoji'], unique: true });
});

test('FK column becomes a typeId reference; unresolved refs are reported', () => {
  const withResolver = introspect(reactions, {
    typeIdForTable: (t) => (t === 'discussions_messages' ? 'aaaaaaaa-0000-4000-8000-000000000002' : undefined),
  });
  assert.equal(withResolver.typeItem.payload.jsonSchema.properties.messageId.typeId, 'aaaaaaaa-0000-4000-8000-000000000002');
  assert.deepEqual(
    withResolver.report.references.find((r) => r.field === 'messageId'),
    { field: 'messageId', targetTable: 'discussions_messages', resolved: true },
  );

  const noResolver = introspect(reactions);
  assert.equal(noResolver.report.references[0].resolved, false);
  assert.ok(noResolver.report.seams.some((s) => s.kind === 'fk-to-items' && /UNRESOLVED/.test(s.detail)));
});

test('deterministic: same input → same type UUID and x-ids', () => {
  const a = introspect(threads);
  const b = introspect(threads);
  assert.equal(a.typeItem.item.id, b.typeItem.item.id);
  assert.equal(a.typeItem.payload.jsonSchema.properties.name['x-id'], b.typeItem.payload.jsonSchema.properties.name['x-id']);
});

test('the generated type item projects: schema-compiler emits a real obj_ table with snake columns', () => {
  const { typeItem } = introspect(threads);
  const [ddl] = deriveSqlSchema(typeItem.payload.jsonSchema, { typeId: typeItem.item.id, dialect: 'postgres' });
  assert.match(ddl, /CREATE TABLE "obj_/);
  assert.match(ddl, /item_id UUID NOT NULL/);
  assert.match(ddl, /"created_by_user_id" TEXT/);
  // NOTE: the compiler maps date-time → TEXT (ISO-string), not TIMESTAMPTZ — a
  // fidelity nuance the introspect report surfaces.
  assert.match(ddl, /"latest_message_at" TEXT/);
  assert.match(ddl, /"sort_order" BIGINT/);
});
