/**
 * `{{params.name}}` placeholder substitution for saved queries (spec
 * §queryPayload).
 *
 * SAFETY: this is the injection boundary for user-authored SQL parameters.
 * Placeholder VALUES are always emitted as bound parameters in the target
 * dialect's native form — `$n` positional for Postgres, `@name` named for
 * SQLite — never string-interpolated into the SQL text. The expression itself
 * is the query author's responsibility; the adapters execute it under a
 * read-only guard.
 */

export class QueryParamError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'QueryParamError';
  }
}

/** Placeholder grammar: `{{params.<identifier>}}`, whitespace tolerated. */
const PLACEHOLDER_RE = /\{\{\s*params\.([A-Za-z_][A-Za-z0-9_]*)\s*\}\}/g;

/** Distinct placeholder names in source order. */
export function listQueryPlaceholders(expression: string): string[] {
  const names: string[] = [];
  for (const m of String(expression).matchAll(PLACEHOLDER_RE)) {
    if (!names.includes(m[1])) names.push(m[1]);
  }
  return names;
}

export interface SubstitutedQuery {
  /** The expression with every placeholder replaced by a dialect binding. */
  sql: string;
  /** Postgres: positional values array (index = $n - 1). SQLite: named map
   *  (keys without the `@` prefix, the form better-sqlite3 binds). */
  values: unknown[] | Record<string, unknown>;
}

/**
 * Replace every `{{params.name}}` with a bound-parameter placeholder. A
 * repeated name reuses one binding. Every placeholder must have a value in
 * `params` (undefined is missing; null is a legal value); extra keys in
 * `params` are ignored here — callers validate declared-vs-supplied.
 */
export function substituteQueryParams(
  expression: string,
  params: Record<string, unknown>,
  dialect: 'postgres' | 'sqlite',
): SubstitutedQuery {
  if (dialect !== 'postgres' && dialect !== 'sqlite') {
    throw new QueryParamError(`Unknown dialect: ${dialect}`);
  }
  const missing = listQueryPlaceholders(expression).filter((n) => params[n] === undefined);
  if (missing.length) {
    throw new QueryParamError(`Missing value for parameter(s): ${missing.join(', ')}`);
  }

  if (dialect === 'postgres') {
    const order: string[] = [];
    const sql = String(expression).replace(PLACEHOLDER_RE, (_, name: string) => {
      let idx = order.indexOf(name);
      if (idx < 0) idx = order.push(name) - 1;
      return `$${idx + 1}`;
    });
    return { sql, values: order.map((n) => params[n]) };
  }

  const used: Record<string, unknown> = {};
  const sql = String(expression).replace(PLACEHOLDER_RE, (_, name: string) => {
    used[name] = params[name];
    return `@${name}`;
  });
  return { sql, values: used };
}

/** Server-side row cap for read-only saved-query execution. The default keeps a
 *  preview grid honest; the max bounds memory no matter what the caller asks. */
export const READ_ONLY_SQL_DEFAULT_LIMIT = 1000;
export const READ_ONLY_SQL_MAX_LIMIT = 10000;

export function clampReadOnlyRowLimit(limit?: unknown): number {
  if (limit == null) return READ_ONLY_SQL_DEFAULT_LIMIT;
  const n = Number(limit);
  if (!Number.isInteger(n) || n < 1) {
    throw new QueryParamError(`Invalid rowLimit: ${limit}`);
  }
  return Math.min(n, READ_ONLY_SQL_MAX_LIMIT);
}
