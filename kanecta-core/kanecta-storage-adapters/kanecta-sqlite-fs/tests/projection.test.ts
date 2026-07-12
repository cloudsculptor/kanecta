'use strict';

import fs from 'fs';
import path from 'path';
import os from 'os';
import { SqliteFsAdapter } from '../src/adapter';
import { objTableName } from '@kanecta/schema-compiler';

function tmpAdapter() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'kanecta-proj-'));
  return SqliteFsAdapter.init(root, 'test@example.com');
}
function cleanup(a: any) { fs.rmSync(a.root, { recursive: true, force: true }); }

// A representative user type: scalar, integer, boolean, string-array, plus a
// declared secondary index. Fixed id so the table name is predictable.
const PERSON_ID = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
const PERSON_TABLE = objTableName(PERSON_ID);

function definePerson(a: any) {
  return a.createType('Person', {
    id: PERSON_ID,
    schema: {
      meta: { icon: 'Person' },
      jsonSchema: {
        type: 'object',
        properties: {
          fullName: { type: 'string' },
          age:      { type: 'integer' },
          active:   { type: 'boolean' },
          tags:     { type: 'array', items: { type: 'string' } },
        },
      },
      indexes: [{ fields: ['fullName'] }],
    },
  });
}

const rawTables = (a: any): string[] =>
  a._openDb().prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name = ?`).all(PERSON_TABLE).map((r: any) => r.name);
const tableExists = (a: any): boolean => rawTables(a).length === 1;
const columns = (a: any): string[] =>
  a._openDb().prepare(`PRAGMA table_info("${PERSON_TABLE}")`).all().map((r: any) => r.name);
const rows = (a: any): any[] =>
  a._openDb().prepare(`SELECT * FROM "${PERSON_TABLE}"`).all();
const indexes = (a: any): string[] =>
  a._openDb().prepare(`PRAGMA index_list("${PERSON_TABLE}")`).all().map((r: any) => r.name);

function addPerson(a: any, data: any, value = data.fullName) {
  return a.create({ type: 'object', typeId: PERSON_ID, objectData: data, value });
}

// ─── Table lifecycle ────────────────────────────────────────────────────────

describe('per-type projection — table lifecycle', () => {
  test('a type with no instances has no obj_ table', () => {
    const a = tmpAdapter();
    definePerson(a);
    expect(tableExists(a)).toBe(false);
    expect(a.listProjectedRelations()).not.toContain(PERSON_TABLE);
    cleanup(a);
  });

  test('the first instance materialises the table with schema-derived columns', () => {
    const a = tmpAdapter();
    definePerson(a);
    addPerson(a, { fullName: 'Ada' });
    expect(tableExists(a)).toBe(true);
    expect(columns(a).sort()).toEqual(['active', 'age', 'full_name', 'item_id', 'tags'].sort());
    expect(a.listProjectedRelations()).toContain(PERSON_TABLE);
    cleanup(a);
  });

  test('a second instance does not error and shares the one table (2 rows)', () => {
    const a = tmpAdapter();
    definePerson(a);
    addPerson(a, { fullName: 'Ada' });
    addPerson(a, { fullName: 'Grace' });
    expect(rawTables(a)).toEqual([PERSON_TABLE]);
    expect(rows(a).length).toBe(2);
    cleanup(a);
  });

  test('declared index is created on the table', () => {
    const a = tmpAdapter();
    definePerson(a);
    addPerson(a, { fullName: 'Ada' });
    expect(indexes(a)).toContain('idx_' + PERSON_TABLE + '_full_name');
    cleanup(a);
  });
});

// ─── Row content ────────────────────────────────────────────────────────────

describe('per-type projection — row content', () => {
  test('scalars, booleans and arrays are mapped to columns', () => {
    const a = tmpAdapter();
    definePerson(a);
    const p = addPerson(a, { fullName: 'Ada', age: 36, active: true, tags: ['math', 'cs'] });
    const [row] = rows(a);
    expect(row.item_id).toBe(p.id);
    expect(row.full_name).toBe('Ada');
    expect(row.age).toBe(36);
    expect(row.active).toBe(1);                 // boolean → sqlite integer
    expect(JSON.parse(row.tags)).toEqual(['math', 'cs']); // array → JSON text
    cleanup(a);
  });

  test('an object instance with empty payload still gets a row (item_id only)', () => {
    const a = tmpAdapter();
    definePerson(a);
    const p = a.create({ type: 'object', typeId: PERSON_ID, value: 'blank' });
    expect(tableExists(a)).toBe(true);
    const [row] = rows(a);
    expect(row.item_id).toBe(p.id);
    expect(row.full_name).toBeNull();
    cleanup(a);
  });

  test('writeObjectJson refreshes the row', () => {
    const a = tmpAdapter();
    definePerson(a);
    const p = addPerson(a, { fullName: 'Ada', age: 36 });
    a.writeObjectJson(p.id, { fullName: 'Ada Lovelace', age: 37 });
    const [row] = rows(a);
    expect(row.full_name).toBe('Ada Lovelace');
    expect(row.age).toBe(37);
    cleanup(a);
  });
});

// ─── Delete / soft-delete / restore ───────────────────────────────────────────

describe('per-type projection — delete lifecycle', () => {
  test('deleting a non-last instance leaves the table; deleting the last drops it', () => {
    const a = tmpAdapter();
    definePerson(a);
    const p1 = addPerson(a, { fullName: 'Ada' });
    const p2 = addPerson(a, { fullName: 'Grace' });
    a.delete(p1.id);
    expect(tableExists(a)).toBe(true);
    expect(rows(a).length).toBe(1);
    a.delete(p2.id);
    expect(tableExists(a)).toBe(false);
    cleanup(a);
  });

  test('soft-delete of the last instance keeps the table but drops the row', () => {
    const a = tmpAdapter();
    definePerson(a);
    const p = addPerson(a, { fullName: 'Ada' });
    a.softDelete(p.id);
    expect(tableExists(a)).toBe(true);
    expect(rows(a).length).toBe(0);
    cleanup(a);
  });

  test('restore repopulates the row', () => {
    const a = tmpAdapter();
    definePerson(a);
    const p = addPerson(a, { fullName: 'Ada', age: 36 });
    a.softDelete(p.id);
    a.restore(p.id);
    expect(tableExists(a)).toBe(true);
    const [row] = rows(a);
    expect(row.item_id).toBe(p.id);
    expect(row.age).toBe(36);
    cleanup(a);
  });
});

// ─── update / typeId reassignment ─────────────────────────────────────────────

describe('per-type projection — update', () => {
  test('changing an item\'s typeId moves it and drops the emptied old table', () => {
    const a = tmpAdapter();
    definePerson(a);
    const OTHER_ID = 'ffffffff-1111-2222-3333-444444444444';
    a.createType('Robot', {
      id: OTHER_ID,
      schema: { meta: { icon: 'SmartToy' }, jsonSchema: { type: 'object', properties: { model: { type: 'string' } } } },
    });
    const p = addPerson(a, { fullName: 'Ada' });
    expect(tableExists(a)).toBe(true);
    a.update(p.id, { typeId: OTHER_ID });
    expect(tableExists(a)).toBe(false);                       // Person table dropped (now empty)
    expect(a.listProjectedRelations()).toContain(objTableName(OTHER_ID)); // Robot table created
    cleanup(a);
  });
});

// ─── Rebuild ──────────────────────────────────────────────────────────────────

describe('per-type projection — rebuildIndexes', () => {
  test('reconstructs tables for live types and drops now-empty ones', () => {
    const a = tmpAdapter();
    definePerson(a);
    const p1 = addPerson(a, { fullName: 'Ada' });
    addPerson(a, { fullName: 'Grace' });
    a.softDelete(p1.id);
    a.rebuildIndexes();
    expect(tableExists(a)).toBe(true);
    expect(rows(a).length).toBe(1);          // only the live instance is projected
    cleanup(a);
  });

  test('a type whose only instance was hard-deleted has no table after rebuild', () => {
    const a = tmpAdapter();
    definePerson(a);
    const p = addPerson(a, { fullName: 'Ada' });
    a.delete(p.id);
    a.rebuildIndexes();
    expect(tableExists(a)).toBe(false);
    cleanup(a);
  });
});

// ─── Exemptions ────────────────────────────────────────────────────────────────

describe('per-type projection — exemptions', () => {
  test('non-object items never create an obj_ table', () => {
    const a = tmpAdapter();
    a.create({ value: 'plain text', type: 'text' });
    const objTables = a.listProjectedRelations();
    expect(objTables).toEqual([]);
    cleanup(a);
  });
});

// ─── Projected built-in metadata: relationship ──────────────────────────────────
// Relationships are `relationship` items projected to obj_<relationship>, matching
// the Postgres adapter — the bespoke `relationships` lookup table is retired.

const REL_TYPE_ID = '334ea5f6-6bfa-43e5-b77f-5d811642d897';
const REL_TABLE   = objTableName(REL_TYPE_ID);
const DEPENDS_ON  = '96292b57-7064-44d2-9be1-ae495602dacf';

describe('per-type projection — relationship', () => {
  test('the bespoke relationships table is gone', () => {
    const a = tmpAdapter();
    const gone = a._openDb()
      .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='relationships'").get();
    expect(gone).toBeUndefined();
    cleanup(a);
  });

  test('relate() projects a row into obj_<relationship> with the spec column shape', () => {
    const a = tmpAdapter();
    const x = a.create({ value: 'x' });
    const y = a.create({ value: 'y' });
    a.relate(x.id, 'depends-on', y.id, { note: 'critical' });

    expect(a.listProjectedRelations()).toContain(REL_TABLE);
    const row = a._openDb().prepare(`SELECT * FROM "${REL_TABLE}"`).get();
    expect(row.type_id).toBe(DEPENDS_ON);           // resolved relationship-type UUID
    expect(row.source_id).toBe(x.id);
    expect(row.target_id).toBe(y.id);
    expect(row.note).toBe('critical');
    // The relationship item carries the relationship TYPE UUID.
    expect(a.get(a.listRelationships()[0].id).typeId).toBe(REL_TYPE_ID);
    cleanup(a);
  });

  test('relationships()/listRelationships() read from the projection', () => {
    const a = tmpAdapter();
    const x = a.create({ value: 'x' });
    const y = a.create({ value: 'y' });
    a.relate(x.id, 'depends-on', y.id);
    expect(a.relationships(x.id).outbound).toHaveLength(1);
    expect(a.relationships(x.id).outbound[0].targetId).toBe(y.id);
    expect(a.relationships(y.id).inbound).toHaveLength(1);
    expect(a.relationships(y.id).inbound[0].sourceId).toBe(x.id);
    expect(a.listRelationships()).toHaveLength(1);
    // Empty store (obj_<relationship> not materialised) resolves to empty, not throw.
    expect(a.relationships(a.create({ value: 'z' }).id)).toEqual({ outbound: [], inbound: [] });
    cleanup(a);
  });

  test('custom (unseeded) relationship types project with a null type_id', () => {
    const a = tmpAdapter();
    a.addRelTypes(['affects']);
    const x = a.create({ value: 'x' });
    const y = a.create({ value: 'y' });
    a.relate(x.id, 'affects', y.id);
    const row = a._openDb().prepare(`SELECT * FROM "${REL_TABLE}"`).get();
    expect(row.type_id).toBeNull();                 // no seeded relationship-type item
    expect(a.relationships(x.id).outbound[0].type).toBe('affects');
    cleanup(a);
  });

  test('deleting an endpoint cascades the relationship out of the projection', () => {
    const a = tmpAdapter();
    const x = a.create({ value: 'x' });
    const y = a.create({ value: 'y' });
    a.relate(x.id, 'depends-on', y.id);
    a.delete(x.id);
    expect(a.relationships(y.id).inbound).toHaveLength(0);
    cleanup(a);
  });

  test('projection survives a full rebuild from the filesystem', () => {
    const a = tmpAdapter();
    const x = a.create({ value: 'x' });
    const y = a.create({ value: 'y' });
    a.relate(x.id, 'depends-on', y.id, { note: 'critical' });
    a.rebuildIndexes();                             // drops + reconstructs obj_ from items/
    expect(a.relationships(x.id).outbound).toHaveLength(1);
    expect(a.relationships(x.id).outbound[0].note).toBe('critical');
    expect(a._openDb().prepare(`SELECT type_id FROM "${REL_TABLE}"`).get().type_id).toBe(DEPENDS_ON);
    cleanup(a);
  });
});
