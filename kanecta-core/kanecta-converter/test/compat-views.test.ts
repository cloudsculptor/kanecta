// Tests for the compat-view generator (Gate 1's fidelity mechanism).

import { test } from 'node:test';
import assert from 'node:assert';
import { introspect, generateCompatView } from '../src/index.ts';
import type { SourceTable } from '../src/index.ts';

const threads: SourceTable = {
  name: 'discussions_threads',
  primaryKey: ['id'],
  columns: [
    { name: 'id', sqlType: 'uuid', nullable: false },
    { name: 'name', sqlType: 'text', nullable: false },
    { name: 'created_at', sqlType: 'timestamptz', nullable: true },
    { name: 'archived_at', sqlType: 'timestamptz', nullable: true },
  ],
};

const reactions: SourceTable = {
  name: 'discussions_reactions',
  primaryKey: ['message_id', 'user_id', 'emoji'],
  columns: [
    { name: 'message_id', sqlType: 'uuid', nullable: false },
    { name: 'user_id', sqlType: 'varchar', nullable: false },
    { name: 'emoji', sqlType: 'text', nullable: false },
  ],
};

test('UUID-PK table: view renames item_id back to id, no join needed (faithful mirror)', () => {
  const typeId = introspect(threads).typeItem.item.id;
  const sql = generateCompatView(threads, { typeId });
  assert.match(sql, /CREATE VIEW "discussions_threads" AS/);
  assert.match(sql, /o\.item_id AS "id"/);
  assert.match(sql, /o\."name"/);
  assert.match(sql, new RegExp(`FROM "obj_${typeId.replace(/-/g, '_')}" o;`));
  assert.doesNotMatch(sql, /JOIN/); // all columns are in obj_
});

test('composite-PK table: no id rename; surrogate item_id is not exposed', () => {
  const typeId = introspect(reactions).typeItem.item.id;
  const sql = generateCompatView(reactions, { typeId });
  assert.match(sql, /o\."message_id"/);
  assert.match(sql, /o\."emoji"/);
  assert.doesNotMatch(sql, /AS "id"/);
  assert.doesNotMatch(sql, /item_id/);
});

test('native-mapped columns (Seam 4) are reassembled from the joined items row', () => {
  const typeId = introspect(threads).typeItem.item.id;
  const sql = generateCompatView(threads, {
    typeId,
    nativeColumns: { created_at: 'i.created_at', archived_at: 'i.deleted_at' },
  });
  assert.match(sql, /i\.created_at AS "created_at"/);
  assert.match(sql, /i\.deleted_at AS "archived_at"/);
  assert.match(sql, /JOIN "items" i ON i\.id = o\.item_id/);
  assert.match(sql, /o\."name"/); // non-native column still from obj_
});
