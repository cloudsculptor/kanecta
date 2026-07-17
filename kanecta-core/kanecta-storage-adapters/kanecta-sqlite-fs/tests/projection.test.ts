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
      meta: { icon: 'Person', description: 'A test person type' },
      jsonSchema: {
        '$schema': 'http://json-schema.org/draft-07/schema#',
        type: 'object',
        properties: {
          fullName: { type: 'string', 'x-id': '11111111-1111-4111-8111-000000000001' },
          age:      { type: 'integer', 'x-id': '11111111-1111-4111-8111-000000000002' },
          active:   { type: 'boolean', 'x-id': '11111111-1111-4111-8111-000000000003' },
          tags:     { type: 'array', items: { type: 'string' }, 'x-id': '11111111-1111-4111-8111-000000000004' },
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
      schema: {
        meta: { icon: 'SmartToy', description: 'A test robot type' },
        jsonSchema: {
          '$schema': 'http://json-schema.org/draft-07/schema#',
          type: 'object',
          properties: { model: { type: 'string', 'x-id': '55555555-5555-4555-8555-000000000001' } },
        },
      },
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
  test('a primitive item creates no obj_ table of its own', () => {
    const a = tmpAdapter();
    // A fresh store seeds the built-in licences → obj_<licence> exists; a plain
    // text item must not add any further obj_ table.
    const before = a.listProjectedRelations().length;
    a.create({ value: 'plain text', type: 'text' });
    expect(a.listProjectedRelations().length).toBe(before);
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

// ─── Projected built-in metadata: relationship-type ─────────────────────────────
// The 9 canonical relationship-type items project to obj_<relationship-type>. Their
// own jsonSchema is empty, so the table + each row come from the flat seed
// metaschema (meta_directional/meta_inverse/…), mirroring the Postgres adapter. The
// meta_inverse self-FK cross-references (depends-on ↔ enables) require deferred FK
// seeding.

const RELTYPE_TYPE_ID = '15861dd7-e54c-4209-bceb-bdd65de4f472';
const RELTYPE_TABLE   = objTableName(RELTYPE_TYPE_ID);

describe('per-type projection — relationship-type', () => {
  test('the 9 canonical relationship-type items project to obj_<relationship-type>', () => {
    const a = tmpAdapter();
    expect(a.listProjectedRelations()).toContain(RELTYPE_TABLE);
    const { n } = a._openDb().prepare(`SELECT COUNT(*) AS n FROM "${RELTYPE_TABLE}"`).get();
    expect(n).toBe(9);
    cleanup(a);
  });

  test('the nested type payload is flattened to the seed-metaschema columns', () => {
    const a = tmpAdapter();
    const db = a._openDb();
    // depends-on: directional, description populated, json_schema stored as JSON text.
    const row = db.prepare(
      `SELECT o.* FROM "${RELTYPE_TABLE}" o JOIN items i ON i.id = o.item_id WHERE i.value = 'depends-on'`,
    ).get();
    expect(row.meta_directional).toBe(1);
    expect(typeof row.meta_description).toBe('string');
    expect(row.meta_description.length).toBeGreaterThan(0);
    expect(() => JSON.parse(row.json_schema)).not.toThrow();
    // relates-to is self-inverse and non-directional → meta_directional 0.
    const rel = db.prepare(
      `SELECT o.meta_directional FROM "${RELTYPE_TABLE}" o JOIN items i ON i.id = o.item_id WHERE i.value = 'relates-to'`,
    ).get();
    expect(rel.meta_directional).toBe(0);
    cleanup(a);
  });

  test('meta_inverse self-FK cross-references resolve to real relationship-type items', () => {
    const a = tmpAdapter();
    const db = a._openDb();
    const dependsOn = db.prepare(
      `SELECT o.meta_inverse FROM "${RELTYPE_TABLE}" o JOIN items i ON i.id = o.item_id WHERE i.value = 'depends-on'`,
    ).get();
    expect(dependsOn.meta_inverse).toBeTruthy();
    // The inverse points at a real, projected relationship-type item (enables).
    const inv = db.prepare(
      `SELECT i.value FROM items i JOIN "${RELTYPE_TABLE}" o ON o.item_id = i.id WHERE i.id = ?`,
    ).get(dependsOn.meta_inverse);
    expect(inv.value).toBe('enables');
    // A self-inverse type (relates-to) carries a null inverse.
    const selfInv = db.prepare(
      `SELECT o.meta_inverse FROM "${RELTYPE_TABLE}" o JOIN items i ON i.id = o.item_id WHERE i.value = 'relates-to'`,
    ).get();
    expect(selfInv.meta_inverse).toBeNull();
    cleanup(a);
  });

  test('projection survives a full rebuild with no dangling meta_inverse FK', () => {
    const a = tmpAdapter();
    a.rebuildIndexes();                             // drops + reconstructs obj_ from items/
    expect(a.listProjectedRelations()).toContain(RELTYPE_TABLE);
    const { n } = a._openDb().prepare(`SELECT COUNT(*) AS n FROM "${RELTYPE_TABLE}"`).get();
    expect(n).toBe(9);
    const dangling = a._openDb().prepare(
      `SELECT COUNT(*) AS n FROM "${RELTYPE_TABLE}" o
        WHERE o.meta_inverse IS NOT NULL
          AND NOT EXISTS (SELECT 1 FROM items i WHERE i.id = o.meta_inverse)`,
    ).get();
    expect(dangling.n).toBe(0);
    cleanup(a);
  });
});

// ─── Projected built-in metadata: alias ─────────────────────────────────────────
// Aliases are `alias` items projected to obj_<alias> — the alias string is
// item.value; the payload holds target_id/…. The bespoke `aliases` table is gone.

const ALIAS_TYPE_ID = '80f95b21-6c51-43b5-bdfb-35aad8991c7a';
const ALIAS_TABLE   = objTableName(ALIAS_TYPE_ID);

describe('per-type projection — alias', () => {
  test('the bespoke aliases table is gone', () => {
    const a = tmpAdapter();
    const gone = a._openDb()
      .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='aliases'").get();
    expect(gone).toBeUndefined();
    cleanup(a);
  });

  test('setAlias() projects a row with the spec column shape; the string is item.value', () => {
    const a = tmpAdapter();
    const t = a.create({ value: 'target' });
    a.setAlias('the-alias', t.id);
    expect(a.listProjectedRelations()).toContain(ALIAS_TABLE);
    const row = a._openDb().prepare(`SELECT * FROM "${ALIAS_TABLE}"`).get();
    expect(row.target_id).toBe(t.id);
    expect(row.provisional).toBe(0);
    expect(row.assigned_by).toBeNull();
    expect(row.computed_from_formula_id).toBeNull();
    const aliasItem = a.get(row.item_id);
    expect(aliasItem.value).toBe('the-alias');
    expect(aliasItem.typeId).toBe(ALIAS_TYPE_ID);
    cleanup(a);
  });

  test('resolveAlias/listAliases/removeAlias read + write the projection', () => {
    const a = tmpAdapter();
    const t = a.create({ value: 'target' });
    a.setAlias('a1', t.id);
    expect(a.resolveAlias('a1')).toBe(t.id);
    expect(a.resolveAlias('missing')).toBeNull();          // no throw on empty match
    expect(a.listAliases()).toEqual([{ alias: 'a1', targetId: t.id }]);
    a.removeAlias('a1');
    expect(a.resolveAlias('a1')).toBeNull();
    expect(a.listAliases()).toEqual([]);
    cleanup(a);
  });

  test('setAlias() overwrites the target of an existing alias string', () => {
    const a = tmpAdapter();
    const t1 = a.create({ value: 't1' });
    const t2 = a.create({ value: 't2' });
    a.setAlias('same', t1.id);
    a.setAlias('same', t2.id);
    expect(a.resolveAlias('same')).toBe(t2.id);
    expect(a.listAliases()).toHaveLength(1);
    cleanup(a);
  });

  test('deleting the target cascades the alias out of the projection', () => {
    const a = tmpAdapter();
    const t = a.create({ value: 'target' });
    a.setAlias('gone-soon', t.id);
    a.delete(t.id);
    expect(a.resolveAlias('gone-soon')).toBeNull();
    expect(a.listAliases()).toEqual([]);
    cleanup(a);
  });

  test('projection survives a full rebuild from the filesystem', () => {
    const a = tmpAdapter();
    const t = a.create({ value: 'target' });
    a.setAlias('persists', t.id);
    a.rebuildIndexes();
    expect(a.resolveAlias('persists')).toBe(t.id);
    expect(a.listAliases()).toEqual([{ alias: 'persists', targetId: t.id }]);
    cleanup(a);
  });
});

// ─── Projected built-in metadata: annotation ────────────────────────────────────
// Annotations are `annotation` items under the annotation type-UUID container,
// projected to obj_<annotation> {targetId, body, parentAnnotationId}; author =
// createdBy. The bespoke `annotations` table is gone.

const ANNOTATION_TYPE_ID = '235d6155-db2a-4232-9548-8f5a66150d82';
const ANN_TABLE          = objTableName(ANNOTATION_TYPE_ID);

describe('per-type projection — annotation', () => {
  test('the bespoke annotations table is gone', () => {
    const a = tmpAdapter();
    const gone = a._openDb()
      .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='annotations'").get();
    expect(gone).toBeUndefined();
    cleanup(a);
  });

  test('annotate() projects a row and parents under the type container', () => {
    const a = tmpAdapter();
    const t = a.create({ value: 'target' });
    const ann = a.annotate(t.id, { content: 'a note', author: 'alice@x.z' });
    expect(a.listProjectedRelations()).toContain(ANN_TABLE);
    const row = a._openDb().prepare(`SELECT * FROM "${ANN_TABLE}"`).get();
    expect(row.target_id).toBe(t.id);
    expect(row.body).toBe('a note');
    expect(row.parent_annotation_id).toBeNull();
    const item = a.get(ann.id);
    expect(item.parentId).toBe(ANNOTATION_TYPE_ID);
    expect(item.typeId).toBe(ANNOTATION_TYPE_ID);
    cleanup(a);
  });

  test('annotations() reads the projection: author=createdBy, threaded replies', () => {
    const a = tmpAdapter();
    const t = a.create({ value: 'target' });
    const root  = a.annotate(t.id, { content: 'root', author: 'alice@x.z' });
    a.annotate(t.id, { content: 'reply', parentAnnotationId: root.id });
    const anns = a.annotations(t.id);
    expect(anns).toHaveLength(2);
    expect(anns[0].author).toBe('alice@x.z');
    expect(anns[0].content).toBe('root');
    expect(anns[1].parentAnnotationId).toBe(root.id);
    expect(a.annotations(a.create({ value: 'x' }).id)).toEqual([]);   // empty, no throw
    cleanup(a);
  });

  test('deleting the target cascades threaded annotations out of the projection', () => {
    const a = tmpAdapter();
    const t = a.create({ value: 'target' });
    const root = a.annotate(t.id, { content: 'root' });
    a.annotate(t.id, { content: 'reply', parentAnnotationId: root.id });
    a.delete(t.id);
    expect(a.annotations(t.id)).toEqual([]);
    cleanup(a);
  });

  test('projection survives a full rebuild from the filesystem', () => {
    const a = tmpAdapter();
    const t = a.create({ value: 'target' });
    a.annotate(t.id, { content: 'persisted note', author: 'bob@x.z' });
    a.rebuildIndexes();
    const anns = a.annotations(t.id);
    expect(anns).toHaveLength(1);
    expect(anns[0].content).toBe('persisted note');
    expect(anns[0].author).toBe('bob@x.z');
    cleanup(a);
  });
});

// ─── Projected built-in metadata: licence ───────────────────────────────────────
// The built-in licences are seeded as `licence` items under the licence type
// container and projected to obj_<licence> {spdxId,name,url,text} — giving the
// DEFAULT_LICENSE referenced by every item's meta.license a real backing item.

const LICENCE_TYPE_ID = '9798b629-06f4-495f-90e8-2d70f817466e';
const LICENCE_TABLE   = objTableName(LICENCE_TYPE_ID);
const DEFAULT_LICENSE = 'bb3bf137-d8a9-4264-9fb7-ac373b1d4739';

describe('per-type projection — licence', () => {
  test('the built-in licences are seeded and projected to obj_<licence>', () => {
    const a = tmpAdapter();
    expect(a.listProjectedRelations()).toContain(LICENCE_TABLE);
    const n = a._openDb().prepare(`SELECT COUNT(*) AS n FROM "${LICENCE_TABLE}"`).get().n;
    expect(n).toBe(19);
    const row = a._openDb().prepare(`SELECT * FROM "${LICENCE_TABLE}" WHERE item_id = ?`).get(DEFAULT_LICENSE);
    expect(row.name).toBe('All Rights Reserved (Copyright)');
    cleanup(a);
  });

  test('DEFAULT_LICENSE has a real backing item that meta.license resolves to', () => {
    const a = tmpAdapter();
    expect(a.get(DEFAULT_LICENSE)?.type).toBe('licence');
    const item = a.create({ value: 'x' });
    const licenceId = a.get(item.id).license;
    expect(licenceId).toBe(DEFAULT_LICENSE);
    expect(a.get(licenceId)).not.toBeNull();               // resolves to the backing item
    cleanup(a);
  });

  test('licence items never leak into content traversal', () => {
    const a = tmpAdapter();
    expect(a.loadAll().every((i: any) => i.type !== 'licence')).toBe(true);
    cleanup(a);
  });

  test('projection is rebuilt from the filesystem', () => {
    const a = tmpAdapter();
    a.rebuildIndexes();
    const n = a._openDb().prepare(`SELECT COUNT(*) AS n FROM "${LICENCE_TABLE}"`).get().n;
    expect(n).toBe(19);
    cleanup(a);
  });
});
