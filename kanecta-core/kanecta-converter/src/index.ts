// @kanecta/converter — deterministic tooling to move a standard web app onto a
// Kanecta backend. See kanecta-converter-specification/1.4.0/specification.converter.adoc.
//
// Gate-1 tools: `readPgCatalog` (live Postgres catalog → SourceTable[], the
// read-only DB adapter), `introspect` (a source table → a Kanecta type item +
// a seams/fidelity report), `generateCompatView` (the CREATE VIEW), and
// `compareSchemas` (source ↔ projection fidelity).
// Gate-2 tools: `scaffoldEndpoint`/`scaffoldEndpoints` (a REST route → a `query`
// item, or a `function` stub + punch-list for writes/side-effects/integrations)
// and `diffResponses` (old endpoint ↔ Kanecta-served response, byte-for-byte).
// Still to build: `backfill` (idempotent source-rows → item upserts).

export { introspect, snakeToCamel, snakeToPascal, deterministicUuid } from './introspect.ts';
export { generateCompatView } from './compat-views.ts';
export type { CompatViewOptions } from './compat-views.ts';
export { compareSchemas, sourceFamily } from './schema-diff.ts';
export type { FidelityReport, ColumnComparison, ColumnStatus, TypeFamily, CompareOptions } from './schema-diff.ts';
export { diffResponses } from './response-diff.ts';
export type { ResponseDiffOptions, ResponseDiffReport, ResponseDiffEntry, ResponseDiffKind } from './response-diff.ts';
export { scaffoldEndpoint, scaffoldEndpoints, pathParams } from './endpoint-scaffold.ts';
export type { SourceEndpoint, ScaffoldResult, ScaffoldSummary, EndpointClass, HttpMethod } from './endpoint-scaffold.ts';
export {
  readPgCatalog,
  buildSourceTables,
  COLUMNS_SQL,
  PRIMARY_KEYS_SQL,
  FOREIGN_KEYS_SQL,
  INDEXES_SQL,
  ENUMS_SQL,
} from './catalog-pg.ts';
export type {
  SqlClient,
  CatalogRows,
  CatalogColumnRow,
  CatalogPkRow,
  CatalogFkRow,
  CatalogIndexRow,
  CatalogEnumRow,
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
