'use strict';

// Saved-query execution (spec §queryPayload) — the orchestration layer shared
// by the HTTP endpoint (POST /query/:id/run) and the kanecta_run_query MCP
// tool. Loads a `query` item, resolves its `query-param` children against
// caller-supplied values, and hands the expression to the adapter's
// runReadOnlySql — where placeholder values are bound as SQL parameters and the
// statement runs under a DB-level read-only guard.

import { UUID_RE } from './datastore.ts';

// Fixed built-in type-item UUID (spec §built-in type item UUIDs).
const QUERY_TYPE_ID = '1c23396d-c3a0-4f51-9307-a1aecd1f44fa';

export type SavedQueryErrorCode =
  | 'not-found'            // no item with that id
  | 'not-a-query'          // item exists but is not a query item
  | 'unsupported-language' // v1 executes language "sql" only
  | 'bad-param'            // missing/unknown/uncoercible parameter value
  | 'sql-error';           // the expression itself failed in the database

export class SavedQueryError extends Error {
  code: SavedQueryErrorCode;
  constructor(code: SavedQueryErrorCode, message: string) {
    super(message);
    this.name = 'SavedQueryError';
    this.code = code;
  }
}

// Coerce one caller-supplied (or defaultValue) value to its declared
// query-param type. defaultValue arrives in text form (spec: "interpreted per
// `type`"), so string inputs are always acceptable.
export function coerceQueryParamValue(name: string, type: string, raw: unknown): unknown {
  if (raw === null) return null;
  switch (type) {
    case 'string':
      return String(raw);
    case 'number': {
      const n = Number(raw);
      if (typeof raw === 'boolean' || raw === '' || Number.isNaN(n)) {
        throw new SavedQueryError('bad-param', `Parameter "${name}" expects a number, got: ${JSON.stringify(raw)}`);
      }
      return n;
    }
    case 'boolean': {
      if (typeof raw === 'boolean') return raw;
      if (raw === 'true') return true;
      if (raw === 'false') return false;
      throw new SavedQueryError('bad-param', `Parameter "${name}" expects a boolean, got: ${JSON.stringify(raw)}`);
    }
    case 'uuid': {
      const s = String(raw);
      if (!UUID_RE.test(s)) {
        throw new SavedQueryError('bad-param', `Parameter "${name}" expects a UUID, got: ${JSON.stringify(raw)}`);
      }
      return s.toLowerCase();
    }
    case 'date': {
      const d = new Date(String(raw));
      if (Number.isNaN(d.getTime())) {
        throw new SavedQueryError('bad-param', `Parameter "${name}" expects a date, got: ${JSON.stringify(raw)}`);
      }
      return d.toISOString();
    }
    default:
      throw new SavedQueryError('bad-param', `Parameter "${name}" has unknown type "${type}"`);
  }
}

// Merge declared params (query-param children payloads) with caller-supplied
// values: caller > defaultValue; a param with neither is required-and-missing.
// Caller keys that match no declared param are rejected (typo protection).
export function resolveQueryParamValues(
  defs: Array<{ name: string; type: string; defaultValue?: string | null }>,
  supplied: Record<string, unknown>,
): Record<string, unknown> {
  const declared = new Set(defs.map((d) => d.name));
  const unknown = Object.keys(supplied).filter((k) => !declared.has(k));
  if (unknown.length) {
    throw new SavedQueryError('bad-param', `Unknown parameter(s): ${unknown.join(', ')}`);
  }

  const values: Record<string, unknown> = {};
  const missing: string[] = [];
  for (const def of defs) {
    const raw = supplied[def.name] !== undefined ? supplied[def.name] : def.defaultValue ?? undefined;
    if (raw === undefined) { missing.push(def.name); continue; }
    values[def.name] = coerceQueryParamValue(def.name, def.type, raw);
  }
  if (missing.length) {
    throw new SavedQueryError('bad-param', `Missing required parameter(s): ${missing.join(', ')}`);
  }
  return values;
}

export interface SavedQueryResult {
  columns: Array<{ name: string; dataType: string | null }>;
  rows: Array<Record<string, unknown>>;
  rowCount: number;
  truncated: boolean;
  description: string | null;
  returnType: string | null;
}

/** Load and execute the saved query item `queryId` against datastore `ds`. */
export async function runSavedQuery(
  ds: any,
  queryId: string,
  suppliedParams: Record<string, unknown> = {},
  opts: { rowLimit?: number } = {},
): Promise<SavedQueryResult> {
  const item = await ds.get(queryId);
  if (!item) throw new SavedQueryError('not-found', `No item with id ${queryId}`);
  if (item.type !== 'query' && item.typeId !== QUERY_TYPE_ID) {
    throw new SavedQueryError('not-a-query', `Item ${queryId} is a "${item.type}", not a query`);
  }

  const payload = (await ds.readObjectJson(queryId)) ?? {};
  if (!payload.expression) {
    throw new SavedQueryError('not-a-query', `Query ${queryId} has no expression`);
  }
  if (payload.language !== 'sql') {
    throw new SavedQueryError(
      'unsupported-language',
      `Query language "${payload.language}" is not executable yet — only "sql" is`,
    );
  }

  // Parameters are query-param CHILDREN of the query item (the flat one-level
  // rule), never an inline array.
  const children = (await ds.children(queryId)) ?? [];
  const defs: Array<{ name: string; type: string; defaultValue?: string | null }> = [];
  for (const child of children) {
    if (child.type !== 'query-param') continue;
    const p = (await ds.readObjectJson(child.id)) ?? {};
    if (p.name && p.type) defs.push({ name: p.name, type: p.type, defaultValue: p.defaultValue ?? null });
  }
  const values = resolveQueryParamValues(defs, suppliedParams);

  let result;
  try {
    result = await ds.runReadOnlySql(payload.expression, values, { rowLimit: opts.rowLimit });
  } catch (err: any) {
    if (err instanceof SavedQueryError) throw err;
    if (err?.name === 'QueryParamError') throw new SavedQueryError('bad-param', err.message);
    // Anything the database rejected (syntax error, unknown table, write
    // attempt against the read-only guard) is the query author's to fix.
    throw new SavedQueryError('sql-error', String(err?.message ?? err));
  }

  return {
    ...result,
    description: payload.description ?? null,
    returnType: payload.returnType ?? null,
  };
}
