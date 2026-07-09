// @kanecta/converter — deterministic tooling to move a standard web app onto a
// Kanecta backend. See kanecta-converter-specification/1.4.0/specification.converter.adoc.
//
// Gate-1 tool implemented so far: `introspect` (a source table schema → a Kanecta
// type item + a seams/fidelity report). Later gates (schema-diff, compat-views,
// backfill, endpoint-scaffold, response-diff) build on the same parsed-source model.

export { introspect, snakeToCamel, snakeToPascal, deterministicUuid } from './introspect.ts';
export { generateCompatView } from './compat-views.ts';
export type { CompatViewOptions } from './compat-views.ts';
export { compareSchemas, sourceFamily } from './schema-diff.ts';
export type { FidelityReport, ColumnComparison, ColumnStatus, TypeFamily, CompareOptions } from './schema-diff.ts';
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
