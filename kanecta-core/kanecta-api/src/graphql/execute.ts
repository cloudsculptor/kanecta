// The generic execution half of the type-items → GraphQL engine.
//
// buildSchemaModel produced a SchemaModel whose every field carries a `backing`
// (how it is fetched). This module walks those backings to resolve a query — the
// generic resolver the plan calls for: scalar→column, reference→item load,
// containment→children, computed→the referenced function/formula/query item. It
// is written ONCE and is domain-agnostic; there is no per-view or per-domain code.
//
// It is decoupled from storage by the `DataSource` interface: the resolver speaks
// in logical operations (load by id, query a type, fetch children/relations, run
// a computed item) and a DataSource implements them. The Postgres binding is one
// DataSource (its `query` compiles via sql-query.ts and runs SQL; `getById`
// reads obj_<type>; etc.); tests use an in-memory fake. So the whole resolver is
// a pure function of (model, DataSource) and needs no live database to verify.
//
// It also owns the WIRE PROJECTION: output object keys are the GraphQL field
// names from the model (camelCase by default), while storage speaks snake_case
// columns — the boundary lives here, in one place.

import type { SchemaModel, ObjectTypeModel, FieldModel } from './model.ts';
import type { SelectArgs } from './sql-query.ts';

/** A row as it lives in storage: identity + snake_case obj_<type> columns. The
 *  DataSource returns these; the resolver projects them to the wire shape. */
export interface StoredRow {
  id: string;
  parentId?: string;
  /** obj_<type> column values, keyed by snake_case column name. */
  columns: Record<string, unknown>;
}

/** Context threaded through resolution — carries the requesting principal (for
 *  per-viewer computed fields and, later, authz) and anything else per-request. */
export interface ExecContext {
  viewer?: string;
  [key: string]: unknown;
}

/** Storage abstraction the generic resolver runs against. A Postgres impl backs
 *  each method with SQL over items + obj_<type> tables; the test fake backs them
 *  with in-memory maps. All methods may be async. */
export interface DataSource {
  /** Load one row of a type by id, or null if absent. */
  getById(typeName: string, id: string, ctx: ExecContext): Promise<StoredRow | null> | StoredRow | null;
  /** List rows of a type under the G1 where/sort/limit/offset args. */
  query(typeName: string, args: SelectArgs, ctx: ExecContext): Promise<StoredRow[]> | StoredRow[];
  /** Children of `parentId` that are instances of `targetTypeName` (containment). */
  children(
    parentId: string,
    targetTypeName: string,
    opts: { includeDeleted: boolean },
    ctx: ExecContext,
  ): Promise<StoredRow[]> | StoredRow[];
  /** Rows related to `id` via `relationshipType` in `direction`, of the target type. */
  related(
    id: string,
    relationshipType: string | undefined,
    direction: 'outgoing' | 'incoming',
    targetTypeName: string,
    ctx: ExecContext,
  ): Promise<StoredRow[]> | StoredRow[];
  /** Run a computed field's backing function/formula/query item. */
  runComputed(
    backedBy: string,
    scope: 'shared' | 'perViewer',
    args: { row: StoredRow; typeName: string; ctx: ExecContext },
  ): Promise<unknown> | unknown;
}

/** A GraphQL-style selection set: each key is a requested field; the value is
 *  `true` for a scalar/leaf, or a nested Selection for an object-valued field. */
export type Selection = { [field: string]: true | Selection };

// Index a type's fields by wire name for O(1) resolution.
function fieldIndex(type: ObjectTypeModel): Map<string, FieldModel> {
  const m = new Map<string, FieldModel>();
  for (const f of type.fields) m.set(f.name, f);
  return m;
}

export class ExecutionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ExecutionError';
  }
}

/** Executor bound to a model + data source. Build once, reuse per request. */
export class Executor {
  private readonly typesByName = new Map<string, ObjectTypeModel>();
  private readonly fieldsByType = new Map<string, Map<string, FieldModel>>();

  constructor(private readonly model: SchemaModel, private readonly ds: DataSource) {
    for (const t of model.types) {
      this.typesByName.set(t.name, t);
      this.fieldsByType.set(t.name, fieldIndex(t));
    }
  }

  /** Resolve a single object of `typeName` by id under `selection`. */
  async resolveById(typeName: string, id: string, selection: Selection, ctx: ExecContext = {}): Promise<Record<string, unknown> | null> {
    const row = await this.ds.getById(typeName, id, ctx);
    if (!row) return null;
    return this.projectRow(typeName, row, selection, ctx);
  }

  /** Resolve a list of `typeName` under G1 args + `selection`. */
  async resolveList(typeName: string, args: SelectArgs, selection: Selection, ctx: ExecContext = {}): Promise<Record<string, unknown>[]> {
    const rows = await this.ds.query(typeName, args, ctx);
    return Promise.all(rows.map((r) => this.projectRow(typeName, r, selection, ctx)));
  }

  // Project one stored row into the wire shape dictated by the selection.
  private async projectRow(typeName: string, row: StoredRow, selection: Selection, ctx: ExecContext): Promise<Record<string, unknown>> {
    const fields = this.fieldsByType.get(typeName);
    if (!fields) throw new ExecutionError(`Unknown type: ${typeName}`);

    const out: Record<string, unknown> = {};
    for (const [fieldName, sub] of Object.entries(selection)) {
      const field = fields.get(fieldName);
      if (!field) throw new ExecutionError(`Unknown field ${typeName}.${fieldName}`);
      out[fieldName] = await this.resolveField(typeName, field, row, sub, ctx);
    }
    return out;
  }

  private async resolveField(typeName: string, field: FieldModel, row: StoredRow, sub: true | Selection, ctx: ExecContext): Promise<unknown> {
    const b = field.backing;
    switch (b.kind) {
      case 'identity':
        return b.field === 'id' ? row.id : b.field === 'parentId' ? row.parentId ?? null : (row.columns[b.field] ?? null);

      case 'scalarColumn':
        return row.columns[b.column] ?? null;

      case 'reference': {
        const childSel = subSelection(sub, field);
        if (b.relationshipType !== undefined || b.column === undefined) {
          // Relationship-item traversal.
          const targets = await this.ds.related(row.id, b.relationshipType, b.direction ?? 'outgoing', b.targetTypeName, ctx);
          if (b.list) return Promise.all(targets.map((t) => this.projectRow(b.targetTypeName, t, childSel, ctx)));
          return targets[0] ? this.projectRow(b.targetTypeName, targets[0], childSel, ctx) : null;
        }
        // FK-column reference: the column holds the target's id.
        const targetId = row.columns[b.column];
        if (targetId == null) return null;
        const target = await this.ds.getById(b.targetTypeName, String(targetId), ctx);
        return target ? this.projectRow(b.targetTypeName, target, childSel, ctx) : null;
      }

      case 'containment': {
        const childSel = subSelection(sub, field);
        const kids = await this.ds.children(row.id, b.targetTypeName, { includeDeleted: b.includeDeleted }, ctx);
        if (b.list) return Promise.all(kids.map((k) => this.projectRow(b.targetTypeName, k, childSel, ctx)));
        return kids[0] ? this.projectRow(b.targetTypeName, kids[0], childSel, ctx) : null;
      }

      case 'computed':
        return this.ds.runComputed(b.backedBy, b.scope, { row, typeName, ctx });

      default: {
        const _exhaustive: never = b;
        throw new ExecutionError(`Unhandled backing: ${JSON.stringify(_exhaustive)}`);
      }
    }
  }
}

// A nested field must be requested with a sub-selection (object-valued); a bare
// `true` on an object field is an error the caller should catch early.
function subSelection(sub: true | Selection, field: FieldModel): Selection {
  if (sub === true) {
    throw new ExecutionError(`Field "${field.name}" (${field.namedType}) needs a sub-selection`);
  }
  return sub;
}
