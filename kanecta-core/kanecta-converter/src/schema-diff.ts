// schema-diff — Gate 1's fidelity check, in code.
//
// Diffs a source table against its Kanecta projection (the type item introspect
// produced, or a hand-authored/modified one) and classifies EVERY difference as
// either a known, intentional delta (the seams) or a real divergence — turning the
// "validity check" idea into a running gate. Pure + deterministic.
//
// Comparison is at the logical level (column families + index column-sets), not by
// parsing DDL strings, so it works the same whether the projected side comes from
// @kanecta/schema-compiler at build time or from a live obj_ table's information
// schema.

import type { SourceTable, SourceColumn } from './types.ts';

/** Normalised storage family of a column, for a backend-agnostic comparison. */
export type TypeFamily = 'uuid' | 'text' | 'int' | 'float' | 'bool' | 'datetime' | 'date' | 'time' | 'json' | 'other';

export type ColumnStatus =
  | 'match'                // same family
  | 'known-nuance'         // a mismatch we expect (e.g. date-time → text)
  | 'type-mismatch'        // an UNEXPECTED family mismatch (divergence)
  | 'mapped-to-item-id'    // the source PK became the item id (Seam 1)
  | 'mapped-to-native'     // opted onto the item/meta envelope (Seam 4)
  | 'missing';             // source column absent from the projection (fidelity loss)

export interface ColumnComparison {
  source: string;
  projected?: string;
  status: ColumnStatus;
  detail?: string;
}

export interface FidelityReport {
  sourceTable: string;
  /** 'faithful' when every delta is known/expected; 'divergent' otherwise. */
  verdict: 'faithful' | 'divergent';
  columns: ColumnComparison[];
  /** Projected columns with no source counterpart (e.g. the surrogate item_id). */
  extraProjectedColumns: string[];
  indexes: { matched: number; missingInProjection: string[][]; extraInProjection: string[][] };
  /** Human-readable known/expected deltas. */
  deltas: string[];
  /** Unexpected problems that make the verdict 'divergent'. */
  divergences: string[];
}

export interface CompareOptions {
  /** Source columns intentionally mapped onto the native envelope (Seam 4). */
  envelopeColumns?: string[];
}

function snakeToCamel(s: string): string {
  return s.replace(/_+([a-z0-9])/g, (_m, c: string) => c.toUpperCase());
}
function camelToSnake(s: string): string {
  return s.replace(/([a-z0-9])([A-Z])/g, '$1_$2').toLowerCase();
}

/** Family of a raw source SQL type. */
export function sourceFamily(sqlType: string): TypeFamily {
  const t = sqlType.toLowerCase().trim();
  if (t === 'uuid') return 'uuid';
  if (/^(smallint|integer|int|int2|int4|int8|bigint|serial|bigserial|smallserial)/.test(t)) return 'int';
  if (/^(numeric|decimal|real|double|float|money|dec)/.test(t)) return 'float';
  if (/^bool/.test(t)) return 'bool';
  if (/^timestamp/.test(t) || t === 'timestamptz') return 'datetime';
  if (t === 'date') return 'date';
  if (/^time/.test(t)) return 'time';
  if (/^(json|jsonb)/.test(t)) return 'json';
  if (/^(text|varchar|character|char|citext|clob|name)/.test(t)) return 'text';
  return 'other';
}

// Family a jsonSchema property ACTUALLY projects to, matching @kanecta/schema-compiler
// (isRef/format:uuid → uuid; integer → int; number → float; boolean → bool; every
// other string, INCLUDING date-time/date, → text).
function projectedFamily(prop: any): TypeFamily {
  if (prop.typeId || prop['x-kanecta-itemType'] || prop.format === 'uuid') return 'uuid';
  if (prop.type === 'integer') return 'int';
  if (prop.type === 'number') return 'float';
  if (prop.type === 'boolean') return 'bool';
  return 'text';
}

// The projected obj_ columns implied by a type item (column name → family), plus
// its declared index column-sets (in source-column terms).
function projectionFromTypeItem(typeItem: any): { columns: Map<string, TypeFamily>; indexes: string[][] } {
  const props = typeItem?.payload?.jsonSchema?.properties ?? {};
  const columns = new Map<string, TypeFamily>();
  for (const [propName, prop] of Object.entries<any>(props)) {
    columns.set(camelToSnake(propName), projectedFamily(prop));
  }
  const indexes: string[][] = (typeItem?.payload?.indexes ?? []).map((i: any) => (i.fields ?? []).map((f: string) => camelToSnake(f)));
  return { columns, indexes };
}

/** Diff a source table against a Kanecta type item's projection. */
export function compareSchemas(source: SourceTable, typeItem: any, opts: CompareOptions = {}): FidelityReport {
  const { columns: projCols, indexes: projIndexes } = projectionFromTypeItem(typeItem);
  const envelope = new Set(opts.envelopeColumns ?? []);
  const pk = source.primaryKey ?? [];
  const pkCol = pk.length === 1 ? source.columns.find((c) => c.name === pk[0]) : undefined;
  const pkIsUuid = !!pkCol && sourceFamily(pkCol.sqlType) === 'uuid';

  const comparisons: ColumnComparison[] = [];
  const deltas: string[] = [];
  const divergences: string[] = [];
  const matchedProjected = new Set<string>();

  for (const col of source.columns) {
    // Seam 1: a single UUID PK becomes the item id (not an obj_ column).
    if (pk.length === 1 && pkIsUuid && col.name === pk[0]) {
      comparisons.push({ source: col.name, status: 'mapped-to-item-id', detail: 'UUID PK → item id (item_id)' });
      deltas.push(`${col.name}: UUID PK → item id (Seam 1)`);
      continue;
    }
    // Seam 4: opted onto the native envelope.
    if (envelope.has(col.name)) {
      comparisons.push({ source: col.name, status: 'mapped-to-native', detail: 'mapped to the item/meta envelope' });
      deltas.push(`${col.name}: mapped to native envelope (Seam 4)`);
      continue;
    }

    const projName = col.name; // obj_ columns are snake(camel(source)) == source for snake sources
    const projFam = projCols.get(projName);
    if (projFam === undefined) {
      comparisons.push({ source: col.name, status: 'missing', detail: 'absent from the projection' });
      divergences.push(`${col.name}: MISSING from the projection (fidelity loss)`);
      continue;
    }
    matchedProjected.add(projName);
    const srcFam = sourceFamily(col.sqlType);
    if (srcFam === projFam) {
      comparisons.push({ source: col.name, projected: projName, status: 'match' });
    } else if ((srcFam === 'datetime' || srcFam === 'date' || srcFam === 'time') && projFam === 'text') {
      comparisons.push({ source: col.name, projected: projName, status: 'known-nuance', detail: `${srcFam} → text (compiler stores ISO string)` });
      deltas.push(`${col.name}: ${srcFam} → TEXT (known compiler nuance)`);
    } else {
      comparisons.push({ source: col.name, projected: projName, status: 'type-mismatch', detail: `${srcFam} ≠ ${projFam}` });
      divergences.push(`${col.name}: type mismatch ${srcFam} ≠ ${projFam}`);
    }
  }

  // Projected columns with no source counterpart (the surrogate item_id is expected).
  const extraProjectedColumns = [...projCols.keys()].filter((c) => !matchedProjected.has(c) && !source.columns.some((s) => s.name === c));

  // Indexes: compare column-sets (order-insensitive at the set level).
  const key = (cols: string[]) => [...cols].sort().join(',');
  const projSet = new Set(projIndexes.map(key));
  const srcIndexes = (source.indexes ?? []).map((i) => i.columns);
  const missingInProjection = srcIndexes.filter((i) => !projSet.has(key(i)));
  const srcSet = new Set(srcIndexes.map(key));
  const extraInProjection = projIndexes.filter((i) => !srcSet.has(key(i)));
  const matched = srcIndexes.length - missingInProjection.length;
  for (const mi of missingInProjection) divergences.push(`index (${mi.join(', ')}): MISSING from the projection`);

  const verdict: FidelityReport['verdict'] = divergences.length === 0 ? 'faithful' : 'divergent';
  return {
    sourceTable: source.name,
    verdict,
    columns: comparisons,
    extraProjectedColumns,
    indexes: { matched, missingInProjection, extraInProjection },
    deltas,
    divergences,
  };
}

// re-exported for callers that want the camelCase form
export { snakeToCamel };
