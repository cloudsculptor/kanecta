// @kanecta/converter — deterministic tooling to move a standard web app onto a
// Kanecta backend. See kanecta-converter-specification/1.4.0/specification.converter.adoc.
//
// Gate-1 tools implemented: `readPgCatalog` (live Postgres catalog → SourceTable[],
// the read-only DB adapter), `introspect` (a source table → a Kanecta type item +
// a seams/fidelity report), `generateCompatView` (the CREATE VIEW), and
// `compareSchemas` (source ↔ projection fidelity). Later gates (backfill,
// endpoint-scaffold, response-diff) build on the same parsed-source model.

export { introspect, snakeToCamel, snakeToPascal, deterministicUuid } from './introspect.ts';
export { generateCompatView } from './compat-views.ts';
export type { CompatViewOptions } from './compat-views.ts';
export { compareSchemas, sourceFamily } from './schema-diff.ts';
export type { FidelityReport, ColumnComparison, ColumnStatus, TypeFamily, CompareOptions } from './schema-diff.ts';
export {
  readPgCatalog,
  buildSourceTables,
  COLUMNS_SQL,
  PRIMARY_KEYS_SQL,
  FOREIGN_KEYS_SQL,
  INDEXES_SQL,
} from './catalog-pg.ts';
export type {
  SqlClient,
  CatalogRows,
  CatalogColumnRow,
  CatalogPkRow,
  CatalogFkRow,
  CatalogIndexRow,
  ReadPgCatalogOptions,
} from './catalog-pg.ts';
export type {
  SourceTable,
  SourceColumn,
  SourceForeignKey,
  SourceIndex,
  IntrospectOptions,
  IntrospectResult,
  IntrospectReport,
  Seam,
  SeamKind,
} from './types.ts';
