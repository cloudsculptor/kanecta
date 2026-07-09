// Tests for the schema-diff fidelity comparator (Gate 1's validity check).

import { test } from 'node:test';
import assert from 'node:assert';
import { introspect, compareSchemas } from '../src/index.ts';
import type { SourceTable } from '../src/index.ts';

const threads: SourceTable = {
  name: 'discussions_threads',
  primaryKey: ['id'],
  columns: [
    { name: 'id', sqlType: 'uuid', nullable: false },
    { name: 'name', sqlType: 'text', nullable: false },
    { name: 'created_at', sqlType: 'timestamptz', nullable: true },
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
    { name: 'created_at', sqlType: 'timestamptz', nullable: true },
  ],
};

test('a generated projection is FAITHFUL — every delta is known/expected', () => {
  const { typeItem } = introspect(threads);
  const report = compareSchemas(threads, typeItem);
  assert.equal(report.verdict, 'faithful');
  assert.deepEqual(report.divergences, []);
  // Seam 1 (id → item id) and the date-time → TEXT nuance are reported as known deltas.
  assert.ok(report.deltas.some((d) => /UUID PK → item id/.test(d)));
  assert.ok(report.deltas.some((d) => /datetime → TEXT/.test(d)));
  // The index was transcribed → matched.
  assert.equal(report.indexes.missingInProjection.length, 0);
  assert.equal(report.columns.find((c) => c.source === 'name')!.status, 'match');
  assert.equal(report.columns.find((c) => c.source === 'created_at')!.status, 'known-nuance');
});

test('composite-PK projection is FAITHFUL; the surrogate UNIQUE index is extra, not missing', () => {
  const { typeItem } = introspect(reactions);
  const report = compareSchemas(reactions, typeItem);
  assert.equal(report.verdict, 'faithful');
  // The FK/PK-part columns are kept and match.
  assert.equal(report.columns.find((c) => c.source === 'message_id')!.status, 'match');
  // The surrogate composite-UNIQUE index appears as extra (expected), not missing.
  assert.ok(report.indexes.extraInProjection.length >= 1);
});

test('a DROPPED column is flagged as a divergence (fidelity loss)', () => {
  const { typeItem } = introspect(threads);
  delete typeItem.payload.jsonSchema.properties.name; // simulate a hand-modified type
  const report = compareSchemas(threads, typeItem);
  assert.equal(report.verdict, 'divergent');
  assert.equal(report.columns.find((c) => c.source === 'name')!.status, 'missing');
  assert.ok(report.divergences.some((d) => /name: MISSING/.test(d)));
});

test('an unexpected type change is flagged as a divergence', () => {
  const { typeItem } = introspect(threads);
  // Force sortOrder to a string in the type → projects to TEXT, source is integer.
  typeItem.payload.jsonSchema.properties.sortOrder = { 'x-id': 'x', type: 'string' };
  const report = compareSchemas(threads, typeItem);
  assert.equal(report.verdict, 'divergent');
  const c = report.columns.find((x) => x.source === 'sort_order')!;
  assert.equal(c.status, 'type-mismatch');
  assert.ok(report.divergences.some((d) => /sort_order: type mismatch int ≠ text/.test(d)));
});

test('a missing index is a divergence', () => {
  const { typeItem } = introspect(threads);
  typeItem.payload.indexes = []; // drop the transcribed index
  const report = compareSchemas(threads, typeItem);
  assert.equal(report.verdict, 'divergent');
  assert.deepEqual(report.indexes.missingInProjection, [['sort_order', 'name']]);
});
