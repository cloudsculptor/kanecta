// compat-views — Gate 1's fidelity mechanism, in code.
//
// Generates a `CREATE VIEW <oldTable> AS …` that reassembles a source table's
// exact shape from the Kanecta projection (`obj_<uuid>` + optionally the `items`
// envelope), so the UNMODIFIED old application can read the converted storage and
// its own test suite can prove fidelity by execution.
//
// This is the throwaway conversion-gate form of the `sql-view` item concept (see
// the main Kanecta spec `sqlViewPayload` and the converter spec): a `SELECT` that
// presents Kanecta storage under a legacy table name/shape. Pure + deterministic.
//
// NOTE the same authz caveat as `sql-view` items: a view BYPASSES Kanecta's
// per-item grant/visibility checks. Compat views are internal-only (the migration
// host), never a public surface.

import type { SourceTable } from './types.ts';

export interface CompatViewOptions {
  /** UUID of the Kanecta type the table maps to (→ obj_<uuid> table). */
  typeId: string;
  /** The items table name (default 'items'). */
  itemsTable?: string;
  /** Source columns to pull from the item envelope instead of an obj_ column
   *  (Seam 4), e.g. { created_at: 'i.created_at', archived_at: 'i.deleted_at' }.
   *  When present the view JOINs the items table. Default: none — a faithful
   *  mirror keeps every column in obj_, so no join is needed. */
  nativeColumns?: Record<string, string>;
}

function objTableName(typeId: string): string {
  if (!/^[0-9a-f-]{36}$/i.test(typeId)) throw new Error(`Not a UUID: ${typeId}`);
  return `obj_${typeId.replace(/-/g, '_')}`;
}

function q(ident: string): string {
  if (ident.includes('"')) throw new Error(`Illegal identifier: ${ident}`);
  return `"${ident}"`;
}

/** Generate the compatibility view SQL for a source table over its Kanecta
 *  projection. Reads only — Gate 1 is a read-fidelity proof. */
export function generateCompatView(table: SourceTable, opts: CompatViewOptions): string {
  const obj = objTableName(opts.typeId);
  const items = opts.itemsTable ?? 'items';
  const native = opts.nativeColumns ?? {};
  const pk = table.primaryKey ?? [];
  const singleCol = pk.length === 1 ? table.columns.find((c) => c.name === pk[0]) : undefined;
  const singleUuidPk = !!singleCol && singleCol.sqlType.toLowerCase().trim() === 'uuid';

  const selects: string[] = [];
  for (const col of table.columns) {
    if (singleUuidPk && col.name === pk[0]) {
      // Seam 1: the UUID PK is stored as obj_.item_id — present it under its old name.
      selects.push(`o.item_id AS ${q(col.name)}`);
      continue;
    }
    if (native[col.name]) {
      // Seam 4: reassemble an envelope-native column from the joined items row.
      selects.push(`${native[col.name]} AS ${q(col.name)}`);
      continue;
    }
    selects.push(`o.${q(col.name)}`);
  }

  const needsJoin = Object.keys(native).length > 0;
  const from = needsJoin ? `${q(obj)} o JOIN ${q(items)} i ON i.id = o.item_id` : `${q(obj)} o`;
  return `CREATE VIEW ${q(table.name)} AS\n  SELECT ${selects.join(', ')}\n  FROM ${from};`;
}
