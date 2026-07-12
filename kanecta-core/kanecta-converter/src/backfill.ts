// backfill — the data-migration tool (Gate 1's row half).
//
// Turns source table rows into idempotent Kanecta item upserts that mirror what
// `introspect` declared for the same table, so a backfilled item round-trips
// through the compat view to the old row shape. Pure and deterministic: same rows
// → same plan (no clock, no random). It only PLANS the upserts; an executor applies
// them against the datastore — kept separate so the mapping is unit-testable.
//
// The two production hazards the nonprod Gate-1 run surfaced are handled here:
//   * Gap D (preserve UUIDs): a single UUID primary key becomes the item id
//     verbatim — never re-minted — because those ids are FK targets. Re-running is
//     naturally idempotent (same id).
//   * Gap C (composite / serial keys): the idempotency key (sourceExternalId) is
//     the NATURAL key, and the item id is a deterministic surrogate derived from
//     it — so a re-seed that renumbers serial ids does not create duplicates. A
//     serial single-PK table has no natural key in its PK, so backfill flags it:
//     set `idempotencyColumns` to the real unique column(s) (a punch-list line).
//
// FKs become graph structure: the designated containment FK → the item's parentId;
// every other FK → a relationship edge. The FK columns are ALSO kept as object
// fields (matching introspect's faithful projection).

import { snakeToCamel, deterministicUuid } from './introspect.ts';
import type { SourceTable } from './types.ts';

const ROOT_UUID = '00000000-0000-0000-0000-000000000000';

export interface BackfillOptions {
  /** The Kanecta type UUID for this table (from introspect). */
  typeId: string;
  /** Idempotency namespace, e.g. 'community-hub'. Default 'source'. */
  sourceSystem?: string;
  /** FK column whose referenced UUID becomes the item's parentId (containment).
   *  e.g. a message's `thread_id`. */
  parentColumn?: string;
  /** parentId for rows with no containment FK (the domain container). Default root. */
  defaultParentId?: string;
  /** relationshipType per non-parent FK column (default: the column name). */
  relationshipTypes?: Record<string, string>;
  /** A soft-delete column (archived_at / deleted_at) → item.deletedAt (native),
   *  removed from objectData. Default: kept as a faithful object field. */
  softDeleteColumn?: string;
  /** Columns that form the idempotency key (sourceExternalId). Default: the PK.
   *  Override for a serial-PK table with its real natural key (Gap C). */
  idempotencyColumns?: string[];
  /** Source columns mapped onto the native envelope instead of objectData (Seam 4). */
  envelopeColumns?: string[];
  owner?: string;
}

export interface RelationshipEdge {
  sourceId: string;
  targetId: string;
  type: string;
}

export interface ItemUpsert {
  /** The item id — a preserved source UUID (Gap D) or a deterministic surrogate. */
  id: string;
  parentId: string;
  type: 'object';
  typeId: string;
  sourceSystem: string;
  /** "<table>:<key>" — the idempotency key an upsert matches on. */
  sourceExternalId: string;
  /** Native soft-delete timestamp, when a softDeleteColumn was mapped; else null. */
  deletedAt: string | null;
  owner?: string;
  /** camelCase property → value, matching the type's jsonSchema. */
  objectData: Record<string, unknown>;
}

export interface BackfillPlan {
  table: string;
  upserts: ItemUpsert[];
  relationships: RelationshipEdge[];
  stats: {
    rows: number;
    preservedUuids: number;
    surrogateKeys: number;
    relationships: number;
    softDeleted: number;
    /** Non-parent FK values that were null (no edge emitted). */
    nullFkSkipped: number;
  };
  notes: string[];
}

/** Plan the idempotent item upserts for a table's rows. Pure + deterministic. */
export function planBackfill(table: SourceTable, rows: Record<string, unknown>[], opts: BackfillOptions): BackfillPlan {
  const sourceSystem = opts.sourceSystem ?? 'source';
  const defaultParent = opts.defaultParentId ?? ROOT_UUID;
  const pk = table.primaryKey ?? [];
  const columnByName = new Map(table.columns.map((c) => [c.name, c]));
  const singlePkCol = pk.length === 1 ? columnByName.get(pk[0]) : undefined;
  const pkIsUuid = !!singlePkCol && singlePkCol.sqlType.toLowerCase().trim() === 'uuid';
  const fkColumns = new Set((table.foreignKeys ?? []).map((fk) => fk.column));
  const idemCols = opts.idempotencyColumns ?? pk;
  const envelope = new Set(opts.envelopeColumns ?? []);

  const notes: string[] = [];
  if (!idemCols.length) notes.push(`No primary key and no idempotencyColumns — backfill cannot be idempotent; supply idempotencyColumns (Gap C).`);
  if (pk.length === 1 && !pkIsUuid) notes.push(`Single non-UUID (serial) PK "${pk[0]}" — idempotency keyed on it is unstable across re-seeds; set idempotencyColumns to the natural key (Gap C).`);
  if (opts.parentColumn && !fkColumns.has(opts.parentColumn)) notes.push(`parentColumn "${opts.parentColumn}" is not a foreign key on ${table.name}.`);

  const upserts: ItemUpsert[] = [];
  const relationships: RelationshipEdge[] = [];
  const stats = { rows: rows.length, preservedUuids: 0, surrogateKeys: 0, relationships: 0, softDeleted: 0, nullFkSkipped: 0 };

  // Columns that do NOT become object fields: the UUID PK (it is the item id), any
  // envelope opt-ins, and a mapped soft-delete column.
  const skip = new Set<string>(envelope);
  if (pk.length === 1 && pkIsUuid) skip.add(pk[0]);
  if (opts.softDeleteColumn) skip.add(opts.softDeleteColumn);

  for (const row of rows) {
    const keyParts = idemCols.map((c) => String(row[c] ?? ''));
    const sourceExternalId = `${table.name}:${keyParts.join('|')}`;

    // Item id: preserve a UUID PK (Gap D); else a deterministic surrogate (Gap C).
    let id: string;
    if (pk.length === 1 && pkIsUuid && row[pk[0]] != null) {
      id = String(row[pk[0]]);
      stats.preservedUuids++;
    } else {
      id = deterministicUuid(`${sourceSystem}:${sourceExternalId}`);
      stats.surrogateKeys++;
    }

    // parentId from the containment FK, else the domain container.
    const parentId = opts.parentColumn && row[opts.parentColumn] != null
      ? String(row[opts.parentColumn])
      : defaultParent;

    // Object fields (camelCase), faithful to introspect (FK + parent columns kept).
    const objectData: Record<string, unknown> = {};
    for (const col of table.columns) {
      if (skip.has(col.name)) continue;
      objectData[snakeToCamel(col.name)] = row[col.name] ?? null;
    }

    // Soft-delete → native deletedAt.
    let deletedAt: string | null = null;
    if (opts.softDeleteColumn && row[opts.softDeleteColumn] != null) {
      deletedAt = String(row[opts.softDeleteColumn]);
      stats.softDeleted++;
    }

    upserts.push({
      id, parentId, type: 'object', typeId: opts.typeId,
      sourceSystem, sourceExternalId, deletedAt,
      ...(opts.owner ? { owner: opts.owner } : {}),
      objectData,
    });

    // Non-parent FKs → relationship edges.
    for (const fk of table.foreignKeys ?? []) {
      if (fk.column === opts.parentColumn) continue;
      const target = row[fk.column];
      if (target == null) { stats.nullFkSkipped++; continue; }
      relationships.push({
        sourceId: id,
        targetId: String(target),
        type: opts.relationshipTypes?.[fk.column] ?? snakeToCamel(fk.column),
      });
      stats.relationships++;
    }
  }

  return { table: table.name, upserts, relationships, stats, notes };
}
