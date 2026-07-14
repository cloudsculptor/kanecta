// The deterministic input + output shapes for the converter.
//
// The tools operate on a PARSED source-schema model (`SourceTable`), not on a live
// connection, so they are pure and unit-testable. A thin DB-reading adapter (per
// engine, over information_schema / pg_catalog) populates `SourceTable`; the
// conversion logic never touches a socket.

/** A column of a source database table. */
export interface SourceColumn {
  /** snake_case source column name, e.g. "created_by_user_id". */
  name: string;
  /** Raw source SQL type, e.g. "uuid", "text", "integer", "timestamptz", "numeric". */
  sqlType: string;
  nullable: boolean;
  /** Column default expression, e.g. "gen_random_uuid()", "now()". Used to flag
   *  non-deterministic seed UUIDs (Gap D). */
  default?: string | null;
  /** For an enum-typed column: the allowed labels, in declaration order. When
   *  present, introspect emits a JSON-Schema `enum` constraint so the projection
   *  carries the same domain constraint the DB enum enforced. */
  enumValues?: string[];
}

/** A foreign key on a source table. */
export interface SourceForeignKey {
  /** The local column that references another table. */
  column: string;
  references: { table: string; column: string };
}

/** A secondary index on a source table. */
export interface SourceIndex {
  name?: string;
  /** Source column names, in order (compound indexes list priority order). */
  columns: string[];
  unique?: boolean;
  /** Partial-index predicate, in source column names. */
  where?: string;
}

/** A parsed source table — the deterministic input to `introspect`. */
export interface SourceTable {
  /** snake_case table name, e.g. "discussions_threads". */
  name: string;
  columns: SourceColumn[];
  /** Primary-key column name(s). Composite when length > 1. */
  primaryKey: string[];
  foreignKeys?: SourceForeignKey[];
  indexes?: SourceIndex[];
}

// ─── Output ──────────────────────────────────────────────────────────────────

export type SeamKind =
  | 'id-to-item-id'
  | 'composite-pk-surrogate'
  | 'fk-to-items'
  | 'envelope-overlap'
  | 'index-transcribed'
  | 'non-deterministic-seed-uuid'
  | 'json-column'
  | 'enum-to-constraint';

export interface Seam {
  kind: SeamKind;
  detail: string;
}

export interface IntrospectReport {
  sourceTable: string;
  /** Derived GraphQL/type name (PascalCase). */
  typeName: string;
  /** Derived item.value (hyphenated). */
  typeValue: string;
  /** camelCase property names emitted on the type. */
  propertiesEmitted: string[];
  /** FK reference fields whose target type UUID must be resolved. */
  references: { field: string; targetTable: string; resolved: boolean }[];
  indexesEmitted: number;
  /** The one genuine structural delta (composite-PK) plus the cosmetic seams and
   *  automatable notes — everything the converter surfaces rather than hides. */
  seams: Seam[];
  notes: string[];
}

export interface IntrospectResult {
  /** A Kanecta `type` item: { item, meta, payload: { meta, jsonSchema, indexes } }. */
  typeItem: any;
  report: IntrospectReport;
}

export interface IntrospectOptions {
  /** UUID for the generated type item. Default: a deterministic UUIDv5 of the type value. */
  typeId?: string;
  /** Override the derived PascalCase type name. */
  typeName?: string;
  /** Override the derived item.value. */
  typeValue?: string;
  /** parentId for the type item (its domain container). Default: the root UUID. */
  parentId?: string;
  owner?: string;
  /** Resolve a referenced source table name → its Kanecta type UUID, to wire FK
   *  reference columns to `typeId`. Unresolved refs are reported for a second pass. */
  typeIdForTable?: (table: string) => string | undefined;
  /** Source columns to map onto the native item/meta envelope (Seam 4) instead of
   *  emitting an obj_ column. Default: none — a faithful mirror keeps every
   *  non-PK column, and envelope candidates are only *reported*. */
  envelopeColumns?: string[];
  /** Expose soft-delete / archive columns (deleted_at, archived_at, …) as normal
   *  filterable GraphQL fields instead of hiding them. Default false (hidden, to
   *  steer consumers toward native soft-delete). Set true for a faithful mirror
   *  of a legacy app whose own queries filter these columns directly
   *  (`WHERE deleted_at IS NULL`, `WHERE archived_at IS NOT NULL`) — the read path
   *  must be able to reproduce those filters. */
  exposeSoftDelete?: boolean;
}
