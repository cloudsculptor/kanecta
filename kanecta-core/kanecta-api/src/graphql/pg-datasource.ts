// A Postgres-backed DataSource for the generic executor.
//
// Backs the executor's logical operations with SQL over the Kanecta datastore:
//   getById   → SELECT the obj_<type> row + the item's parent_id
//   query     → compileSelect (G1 where/sort/pagination) → item ids → load rows
//   children  → obj_<targetType> rows whose item's parent_id = this item (containment)
//   related   → obj_<relationship-type> edges of a given slug (reference collections)
//   runComputed → the field's backing query/formula item (declarative-first)
//
// It reads obj_<type> tables raw (snake_case columns), which is exactly what the
// executor's `backing.column` expects; the executor owns the camelCase wire
// projection. The engine stays dependency-free: the pool is typed as a minimal
// `SqlClient`, so this module doesn't import `pg`.

import { compileSelect, type SelectArgs } from './sql-query.ts';
import type { DataSource, StoredRow, ExecContext } from './execute.ts';
import type { SchemaModel, ObjectTypeModel } from './model.ts';
import { runComputedSpec, ComputedError, type ComputedSpec } from './computed.ts';

/** Minimal pg-Pool-shaped client, so we don't hard-depend on `pg`. */
export interface SqlClient {
  query(sql: string, params?: unknown[]): Promise<{ rows: any[] }>;
}

// Relationships project to obj_<relationship-type> (spec §relationshipPayload) —
// the bespoke `relationships` table was retired by the uniform-projection epic.
// Columns: item_id, type_id (→ the relationship-type item), source_id, target_id,
// data, confidence, note. The slug ('attaches', …) is the relationship-type item's
// `value`, recovered via o.type_id → items. Matches kanecta-postgres' RELATIONSHIP_TYPE_ID.
const RELATIONSHIP_TYPE_ID = '334ea5f6-6bfa-43e5-b77f-5d811642d897';
const objTableName = (typeId: string): string => `obj_${typeId.replace(/-/g, '_')}`;

export interface PgDataSourceOptions {
  /** The items table (default 'items'). */
  itemsTable?: string;
  /** The obj_<relationship-type> projection table (default derived from the built-in
   *  relationship type id). Relationships project here — there is no bespoke
   *  `relationships` table after the uniform-projection epic. */
  relationshipObjTable?: string;
  /** Computed-field runner map: a computed field's `backedBy` id → its resolved
   *  `query`/`formula` spec (see buildComputedMap). Absent → runComputed throws
   *  (the pre-runner behaviour) only when a computed field is actually selected. */
  computed?: Map<string, ComputedSpec>;
}

function q(ident: string): string {
  if (ident.includes('"')) throw new Error(`Illegal identifier: ${ident}`);
  return `"${ident}"`;
}

export class PgDataSource implements DataSource {
  private readonly tableByType = new Map<string, string>();
  private readonly modelByType = new Map<string, ObjectTypeModel>();
  private readonly items: string;
  private readonly rels: string;
  private readonly computed: Map<string, ComputedSpec>;

  constructor(private readonly client: SqlClient, model: SchemaModel, opts: PgDataSourceOptions = {}) {
    for (const t of model.types) {
      this.tableByType.set(t.name, t.tableName);
      this.modelByType.set(t.name, t);
    }
    this.items = opts.itemsTable ?? 'items';
    this.rels = opts.relationshipObjTable ?? objTableName(RELATIONSHIP_TYPE_ID);
    this.computed = opts.computed ?? new Map();
  }

  private tableFor(typeName: string): string {
    const t = this.tableByType.get(typeName);
    if (!t) throw new Error(`PgDataSource: unknown type "${typeName}"`);
    return t;
  }

  // obj row (+ joined parent_id) → StoredRow. The obj columns are already snake_case.
  private toRow(r: Record<string, unknown>): StoredRow {
    const { item_id, __parent_id, ...columns } = r;
    return { id: String(item_id), parentId: __parent_id == null ? undefined : String(__parent_id), columns };
  }

  private selectRowsSql(typeName: string, whereItemIdIn: boolean): string {
    const obj = q(this.tableFor(typeName));
    const items = q(this.items);
    const filter = whereItemIdIn ? 'o.item_id = ANY($1)' : 'i.parent_id = $1';
    return `SELECT o.*, i.parent_id AS __parent_id FROM ${obj} o JOIN ${items} i ON i.id = o.item_id WHERE ${filter}`;
  }

  async getById(typeName: string, id: string): Promise<StoredRow | null> {
    const obj = q(this.tableFor(typeName));
    const items = q(this.items);
    const { rows } = await this.client.query(
      `SELECT o.*, i.parent_id AS __parent_id FROM ${obj} o JOIN ${items} i ON i.id = o.item_id WHERE o.item_id = $1`,
      [id],
    );
    return rows[0] ? this.toRow(rows[0]) : null;
  }

  async query(typeName: string, args: SelectArgs): Promise<StoredRow[]> {
    const type = this.modelByType.get(typeName);
    if (!type) throw new Error(`PgDataSource: unknown type "${typeName}"`);
    // G1: compile where/sort/limit/offset → a parameterised SELECT of item ids...
    const compiled = compileSelect(type, args);
    const { rows: idRows } = await this.client.query(compiled.sql, compiled.params as unknown[]);
    const ids = idRows.map((r) => String(r.item_id));
    if (!ids.length) return [];
    // ...then load the rows and restore the compiled order.
    const { rows } = await this.client.query(this.selectRowsSql(typeName, true), [ids]);
    const byId = new Map(rows.map((r) => [String(r.item_id), this.toRow(r)]));
    return ids.map((id) => byId.get(id)).filter((r): r is StoredRow => r != null);
  }

  async children(parentId: string, targetTypeName: string, optsC: { includeDeleted: boolean }): Promise<StoredRow[]> {
    const obj = q(this.tableFor(targetTypeName));
    const items = q(this.items);
    const del = optsC.includeDeleted ? '' : 'AND i.deleted_at IS NULL';
    const { rows } = await this.client.query(
      `SELECT o.*, i.parent_id AS __parent_id FROM ${obj} o JOIN ${items} i ON i.id = o.item_id WHERE i.parent_id = $1 ${del} ORDER BY o.item_id`,
      [parentId],
    );
    return rows.map((r) => this.toRow(r));
  }

  async related(id: string, relationshipType: string | undefined, direction: 'outgoing' | 'incoming', targetTypeName: string): Promise<StoredRow[]> {
    const rels = q(this.rels);
    const items = q(this.items);
    const fromCol = direction === 'outgoing' ? 'source_id' : 'target_id';
    const toCol = direction === 'outgoing' ? 'target_id' : 'source_id';
    // Read the obj_<relationship-type> projection (mirrors kanecta-postgres'
    // relationships()): the edge's own item (o.item_id) is joined so soft-deleted
    // relationships drop out, and the slug is recovered from the relationship-type
    // item via o.type_id → items.value. `relationshipType` undefined = any type.
    const slugFilter = relationshipType === undefined ? '' : 'AND rt.value = $2';
    const params: unknown[] = relationshipType === undefined ? [id] : [id, relationshipType];
    const { rows: relRows } = await this.client.query(
      `SELECT o.${toCol} AS oid
         FROM ${rels} o
         JOIN ${items} ri ON ri.id = o.item_id AND ri.deleted_at IS NULL
         LEFT JOIN ${items} rt ON rt.id = o.type_id
        WHERE o.${fromCol} = $1 ${slugFilter}`,
      params,
    );
    const ids = relRows.map((r) => String(r.oid));
    if (!ids.length) return [];
    const { rows } = await this.client.query(this.selectRowsSql(targetTypeName, true), [ids]);
    const byId = new Map(rows.map((r) => [String(r.item_id), this.toRow(r)]));
    return ids.map((i) => byId.get(i)).filter((r): r is StoredRow => r != null);
  }

  // Computed fields run their backing `query`/`formula` item (declarative-first).
  // The spec is looked up from the `computed` map (built by buildComputedMap from
  // the datastore's query/formula items); a selected computed field with no wired
  // backing throws the same honest error as before.
  async runComputed(
    backedBy: string,
    _scope: 'shared' | 'perViewer',
    args: { row: StoredRow; typeName: string; ctx: ExecContext },
  ): Promise<unknown> {
    const spec = this.computed.get(backedBy);
    if (!spec) {
      throw new ComputedError(`PgDataSource.runComputed: no backing query/formula wired for computed field ${backedBy}`);
    }
    return runComputedSpec(spec, { row: args.row, ctx: args.ctx, client: this.client });
  }
}
