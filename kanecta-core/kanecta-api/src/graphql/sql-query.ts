// G1 — compile a generated `where` / `sort` / `limit` / `offset` selection into a
// parameterised PostgreSQL query over a type's obj_<uuid> table.
//
// This is the SQL-pushdown half of "the biggest single build" in the cutover
// plan: list queries filter, sort, and paginate IN the database, not by scanning
// items in JS (the gap G1 exists to close). It is a pure function of the
// SchemaModel + the request arguments — no database handle, so it is fully
// unit-testable by asserting the emitted SQL text and parameter array.
//
// SAFETY: every value is a bound parameter ($1, $2, …); every identifier (table,
// column) comes from an ALLOW-LIST derived from the type model, never from the
// request. Unknown fields or operators throw QueryCompileError rather than
// reaching SQL. This is the injection boundary.

import type { ObjectTypeModel, FieldModel } from './model.ts';

export class QueryCompileError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'QueryCompileError';
  }
}

/** SQL affinity of a filterable/sortable column, used to validate operators. */
type ColumnKind = 'text' | 'int' | 'float' | 'bool' | 'id' | 'datetime';

interface Column {
  /** obj_<type> column name. */
  column: string;
  kind: ColumnKind;
}

/** Operators legal per column kind. `contains`/`startsWith` are text-only. */
const OPERATORS: Record<string, { kinds: ColumnKind[]; sql: (col: string, ph: string) => string; transform?: (v: unknown) => unknown }> = {
  eq: { kinds: ['text', 'int', 'float', 'bool', 'id', 'datetime'], sql: (c, p) => `${c} = ${p}` },
  ne: { kinds: ['text', 'int', 'float', 'bool', 'id', 'datetime'], sql: (c, p) => `${c} <> ${p}` },
  gt: { kinds: ['int', 'float', 'datetime'], sql: (c, p) => `${c} > ${p}` },
  gte: { kinds: ['int', 'float', 'datetime'], sql: (c, p) => `${c} >= ${p}` },
  lt: { kinds: ['int', 'float', 'datetime'], sql: (c, p) => `${c} < ${p}` },
  lte: { kinds: ['int', 'float', 'datetime'], sql: (c, p) => `${c} <= ${p}` },
  in: { kinds: ['text', 'int', 'float', 'id'], sql: (c, p) => `${c} = ANY(${p})` },
  contains: { kinds: ['text'], sql: (c, p) => `${c} ILIKE ${p}`, transform: (v) => `%${likeEscape(String(v))}%` },
  startsWith: { kinds: ['text'], sql: (c, p) => `${c} ILIKE ${p}`, transform: (v) => `${likeEscape(String(v))}%` },
  // isNull handled specially (no bound value on the false branch would be odd; we
  // always bind so param positions stay predictable): true → IS NULL, false → IS NOT NULL.
  isNull: { kinds: ['text', 'int', 'float', 'bool', 'id', 'datetime'], sql: () => '' },
};

// Escapes LIKE metacharacters so `contains`/`startsWith` match literally.
function likeEscape(s: string): string {
  return s.replace(/([%_\\])/g, '\\$1');
}

function quoteIdent(name: string): string {
  if (name.includes('"')) throw new QueryCompileError(`Illegal identifier: ${name}`);
  return `"${name}"`;
}

// Builds the allow-list of filterable/sortable columns from a type model. Only
// single scalar columns and the id identity are filterable — lists and
// object-valued fields are not.
function columnsFor(type: ObjectTypeModel): Map<string, Column> {
  const map = new Map<string, Column>();
  for (const f of type.fields) {
    const col = filterableColumn(f);
    if (col) map.set(f.name, col);
  }
  return map;
}

function filterableColumn(f: FieldModel): Column | null {
  if (f.backing.kind === 'identity' && f.backing.field === 'id') {
    return { column: 'item_id', kind: 'id' };
  }
  if (f.backing.kind === 'scalarColumn' && !f.backing.list) {
    return { column: f.backing.column, kind: kindOfScalar(f.namedType) };
  }
  // FK-column references are real UUID columns — filterable/sortable/groupable
  // (e.g. filter messages by thread_id). Relationship-item references have no
  // column and are excluded.
  if (f.backing.kind === 'reference' && !f.backing.list && f.backing.column) {
    return { column: f.backing.column, kind: 'id' };
  }
  return null;
}

function kindOfScalar(namedType: string): ColumnKind {
  switch (namedType) {
    case 'Int': return 'int';
    case 'Float': return 'float';
    case 'Boolean': return 'bool';
    case 'ID': return 'id';
    case 'DateTime': return 'datetime';
    default: return 'text';
  }
}

// Accumulates positional parameters and hands out $N placeholders.
class Params {
  readonly values: unknown[] = [];
  next(value: unknown): string {
    this.values.push(value);
    return `$${this.values.length}`;
  }
}

export interface CompiledQuery {
  /** Parameterised SELECT returning item_id, ordered + paginated. */
  sql: string;
  /** Parameterised SELECT returning the total match count (ignores limit/offset). */
  countSql: string;
  /** Bound parameter values for `sql`. `countSql` uses the same values minus the
   *  trailing limit/offset pair (see `countParams`). */
  params: unknown[];
  /** Bound parameter values for `countSql`. */
  countParams: unknown[];
}

export interface SelectArgs {
  where?: unknown;
  sort?: Array<{ field: string; direction?: 'ASC' | 'DESC'; nulls?: 'FIRST' | 'LAST' }>;
  limit?: number;
  offset?: number;
}

const MAX_LIMIT = 500;

/** Compile a list-query selection over one type into parameterised SQL. */
export function compileSelect(type: ObjectTypeModel, args: SelectArgs): CompiledQuery {
  const columns = columnsFor(type);
  const table = quoteIdent(type.tableName);

  const whereParams = new Params();
  const whereClause = args.where ? compileWhere(args.where, columns, whereParams) : '';
  const where = whereClause ? ` WHERE ${whereClause}` : '';

  const orderBy = compileOrderBy(args.sort ?? [], columns);

  // Count query shares the where params but not limit/offset.
  const countSql = `SELECT count(*)::int AS total FROM ${table}${where}`;
  const countParams = [...whereParams.values];

  // limit/offset extend the same param list for the row query.
  const limit = clampLimit(args.limit);
  const offset = clampOffset(args.offset);
  const limitPh = whereParams.next(limit);
  const offsetPh = whereParams.next(offset);

  const sql = `SELECT item_id FROM ${table}${where}${orderBy} LIMIT ${limitPh} OFFSET ${offsetPh}`;

  return { sql, countSql, params: whereParams.values, countParams };
}

function clampLimit(limit: number | undefined): number {
  if (limit == null) return 50;
  if (!Number.isInteger(limit) || limit < 0) throw new QueryCompileError(`Invalid limit: ${limit}`);
  return Math.min(limit, MAX_LIMIT);
}

function clampOffset(offset: number | undefined): number {
  if (offset == null) return 0;
  if (!Number.isInteger(offset) || offset < 0) throw new QueryCompileError(`Invalid offset: ${offset}`);
  return offset;
}

/** Recursively compile a `where` object into a boolean SQL expression. */
export function compileWhere(where: unknown, columns: Map<string, Column>, params: Params): string {
  if (where == null || typeof where !== 'object') {
    throw new QueryCompileError('where must be an object');
  }
  const conditions: string[] = [];

  for (const [key, value] of Object.entries(where as Record<string, unknown>)) {
    if (value === undefined) continue;

    if (key === 'and' || key === 'or') {
      if (!Array.isArray(value)) throw new QueryCompileError(`"${key}" must be a list`);
      const parts = value.map((sub) => `(${compileWhere(sub, columns, params)})`);
      if (parts.length) conditions.push(`(${parts.join(key === 'and' ? ' AND ' : ' OR ')})`);
      continue;
    }
    if (key === 'not') {
      conditions.push(`NOT (${compileWhere(value, columns, params)})`);
      continue;
    }

    const col = columns.get(key);
    if (!col) throw new QueryCompileError(`Unknown or non-filterable field: ${key}`);
    conditions.push(compileFieldFilter(col, value, params));
  }

  // An empty where object matches everything.
  return conditions.length ? conditions.join(' AND ') : 'TRUE';
}

function compileFieldFilter(col: Column, filter: unknown, params: Params): string {
  if (filter == null || typeof filter !== 'object') {
    throw new QueryCompileError(`Filter for "${col.column}" must be an object of operators`);
  }
  const parts: string[] = [];
  const qCol = quoteIdent(col.column);

  for (const [op, raw] of Object.entries(filter as Record<string, unknown>)) {
    if (raw === undefined) continue;
    const spec = OPERATORS[op];
    if (!spec) throw new QueryCompileError(`Unknown operator "${op}" on field "${col.column}"`);
    if (!spec.kinds.includes(col.kind)) {
      throw new QueryCompileError(`Operator "${op}" is not valid for ${col.kind} field "${col.column}"`);
    }

    if (op === 'isNull') {
      parts.push(raw ? `${qCol} IS NULL` : `${qCol} IS NOT NULL`);
      continue;
    }
    if (op === 'in' && !Array.isArray(raw)) {
      throw new QueryCompileError(`Operator "in" on "${col.column}" requires a list`);
    }
    const value = spec.transform ? spec.transform(raw) : raw;
    parts.push(spec.sql(qCol, params.next(value)));
  }

  if (!parts.length) return 'TRUE';
  return parts.join(' AND ');
}

// ─── G2: aggregations (count / group-by / sum / avg / min / max) ─────────────
//
// Powers the reactions map (GROUP BY emoji COUNT(*) over ch-reaction rows),
// reply/file counts, and finance report rollups — SQL pushdown group-by on the
// obj_<type> columns, not a JS scan. Same allow-list + parameterised-where
// discipline as compileSelect.

export type AggregateFn = 'count' | 'sum' | 'avg' | 'min' | 'max';

export interface AggregateSpec {
  fn: AggregateFn;
  /** Field to aggregate. Optional (and ignored) for `count` → COUNT(*). */
  field?: string;
  /** Output column alias (must be a valid identifier). */
  alias: string;
}

export interface AggregateArgs {
  where?: unknown;
  /** Fields to GROUP BY (each becomes an output column, snake_case). */
  groupBy?: string[];
  aggregates: AggregateSpec[];
}

const AGG_ALLOWED_KINDS: Record<AggregateFn, ColumnKind[] | null> = {
  count: null, // any kind (or none, for COUNT(*))
  sum: ['int', 'float'],
  avg: ['int', 'float'],
  min: ['int', 'float', 'datetime', 'text', 'id'],
  max: ['int', 'float', 'datetime', 'text', 'id'],
};

function isValidAlias(name: string): boolean {
  return /^[A-Za-z_][A-Za-z0-9_]*$/.test(name);
}

/** Compile an aggregation query over one type into parameterised SQL. */
export function compileAggregate(type: ObjectTypeModel, args: AggregateArgs): { sql: string; params: unknown[] } {
  const columns = columnsFor(type);
  const table = quoteIdent(type.tableName);
  if (!args.aggregates?.length) throw new QueryCompileError('aggregate query needs at least one aggregate');

  const params = new Params();
  const whereClause = args.where ? compileWhere(args.where, columns, params) : '';
  const where = whereClause ? ` WHERE ${whereClause}` : '';

  // GROUP BY columns (validated against the allow-list).
  const groupCols: string[] = [];
  for (const field of args.groupBy ?? []) {
    const col = columns.get(field);
    if (!col) throw new QueryCompileError(`Unknown or non-groupable field: ${field}`);
    groupCols.push(quoteIdent(col.column));
  }

  // Aggregate expressions.
  const selectParts = [...groupCols];
  const seenAlias = new Set<string>();
  for (const agg of args.aggregates) {
    if (!isValidAlias(agg.alias)) throw new QueryCompileError(`Invalid aggregate alias: ${agg.alias}`);
    if (seenAlias.has(agg.alias)) throw new QueryCompileError(`Duplicate aggregate alias: ${agg.alias}`);
    seenAlias.add(agg.alias);

    const allowed = AGG_ALLOWED_KINDS[agg.fn];
    if (allowed === undefined) throw new QueryCompileError(`Unknown aggregate function: ${agg.fn}`);

    if (agg.fn === 'count' && !agg.field) {
      selectParts.push(`count(*)::bigint AS ${quoteIdent(agg.alias)}`);
      continue;
    }
    const col = agg.field ? columns.get(agg.field) : undefined;
    if (!col) throw new QueryCompileError(`Unknown or non-aggregatable field: ${agg.field}`);
    if (allowed && !allowed.includes(col.kind)) {
      throw new QueryCompileError(`Aggregate "${agg.fn}" is not valid for ${col.kind} field "${agg.field}"`);
    }
    selectParts.push(`${agg.fn}(${quoteIdent(col.column)}) AS ${quoteIdent(agg.alias)}`);
  }

  const groupBy = groupCols.length ? ` GROUP BY ${groupCols.join(', ')}` : '';
  const sql = `SELECT ${selectParts.join(', ')} FROM ${table}${where}${groupBy}`;
  return { sql, params: params.values };
}

/** Compile a validated ORDER BY clause (empty string when no sort). */
export function compileOrderBy(
  sort: Array<{ field: string; direction?: 'ASC' | 'DESC'; nulls?: 'FIRST' | 'LAST' }>,
  columns: Map<string, Column>,
): string {
  if (!sort.length) return '';
  const parts: string[] = [];
  for (const s of sort) {
    const col = columns.get(s.field);
    if (!col) throw new QueryCompileError(`Unknown or non-sortable field: ${s.field}`);
    const dir = s.direction ?? 'ASC';
    if (dir !== 'ASC' && dir !== 'DESC') throw new QueryCompileError(`Invalid sort direction: ${dir}`);
    let clause = `${quoteIdent(col.column)} ${dir}`;
    if (s.nulls) {
      if (s.nulls !== 'FIRST' && s.nulls !== 'LAST') throw new QueryCompileError(`Invalid nulls order: ${s.nulls}`);
      clause += ` NULLS ${s.nulls}`;
    }
    parts.push(clause);
  }
  return ` ORDER BY ${parts.join(', ')}`;
}
