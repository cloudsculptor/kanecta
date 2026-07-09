// Declarative computed fields — the "runner" for the generic engine.
//
// A computed field (replyCount, hasUnread) is backed by a `query` / `formula` item,
// NOT by hand-written per-domain resolver code (the everything-is-items rule). This
// module executes those backing items:
//
//   * query, language 'sql' — the declarative-first path. The expression is a SELECT
//     with `{{params.name}}` placeholders bound from the current row + viewer and run
//     as PARAMETERISED SQL (never string-interpolated → injection-safe). A scalar
//     field (Int/Boolean) takes the first column of the first row; a list field
//     takes the rows.
//   * formula, level 'template' — simple `{name}` substitution, no dependency.
//   * formula 'dsl'/'function' and query 'kanecta'/'graph' — deferred with a clear
//     error (declarative-first scope; wire the formulajs/runner/AGE paths later).
//
// Binding convention (additive engine contract — no spec change):
//   {{params.self}} / {{params.id}} → the row's item id
//   {{params.viewer}}               → ctx.viewer (per-viewer fields)
//   {{params.<name>}}               → the row's <name> column (camel or snake)

import { camelToSnake } from './naming-strategy.ts';
import type { StoredRow, ExecContext } from './execute.ts';
import type { SchemaModel } from './model.ts';
import type { SqlClient } from './pg-datasource.ts';

export interface ComputedQuerySpec {
  kind: 'query';
  language: string; // 'sql' | 'kanecta' | 'graph' — only 'sql' is executed here
  expression: string;
  /** true → return a single scalar; false → return the rows. From the field's `list`. */
  scalar: boolean;
}
export interface ComputedFormulaSpec {
  kind: 'formula';
  level: string; // 'template' | 'dsl' | 'function' — only 'template' is executed here
  expression: string;
  scalar: boolean;
}
export type ComputedSpec = ComputedQuerySpec | ComputedFormulaSpec;

export class ComputedError extends Error {
  constructor(message: string) { super(message); this.name = 'ComputedError'; }
}

/** Resolve a `{{params.<name>}}` binding from the row + context. */
export function resolveBinding(name: string, row: StoredRow, ctx: ExecContext): unknown {
  if (name === 'self' || name === 'id') return row.id;
  if (name === 'viewer') return ctx.viewer ?? null;
  if (Object.prototype.hasOwnProperty.call(row.columns, name)) return row.columns[name];
  const snake = camelToSnake(name);
  if (Object.prototype.hasOwnProperty.call(row.columns, snake)) return row.columns[snake];
  return null;
}

/** Turn `SELECT … {{params.self}} …` into parameterised SQL + bound values. */
export function bindComputedSql(expression: string, row: StoredRow, ctx: ExecContext): { sql: string; params: unknown[] } {
  const params: unknown[] = [];
  const sql = expression.replace(/\{\{\s*params\.([A-Za-z0-9_]+)\s*\}\}/g, (_m, name: string) => {
    params.push(resolveBinding(name, row, ctx));
    return `$${params.length}`;
  });
  return { sql, params };
}

/** `{name}` template substitution (formula level 'template'). */
export function renderTemplate(expression: string, row: StoredRow, ctx: ExecContext): string {
  return expression.replace(/\{\s*([A-Za-z0-9_]+)\s*\}/g, (_m, name: string) => {
    const v = resolveBinding(name, row, ctx);
    return v == null ? '' : String(v);
  });
}

/** Build a ComputedSpec from a backing item's payload (`query` or `formula`). */
export function computedSpecFromPayload(payload: any, scalar: boolean): ComputedSpec {
  if (payload && typeof payload.expression === 'string' && typeof payload.language === 'string') {
    return { kind: 'query', language: payload.language, expression: payload.expression, scalar };
  }
  if (payload && typeof payload.expression === 'string' && typeof payload.level === 'string') {
    return { kind: 'formula', level: payload.level, expression: payload.expression, scalar };
  }
  throw new ComputedError('Backing item is neither a query (language+expression) nor a formula (level+expression)');
}

/** Execute a resolved ComputedSpec for one row. */
export async function runComputedSpec(
  spec: ComputedSpec,
  args: { row: StoredRow; ctx: ExecContext; client: SqlClient },
): Promise<unknown> {
  if (spec.kind === 'query') {
    if (spec.language !== 'sql') {
      throw new ComputedError(`computed query language "${spec.language}" is not wired yet (declarative-first: sql only)`);
    }
    const { sql, params } = bindComputedSql(spec.expression, args.row, args.ctx);
    const { rows } = await args.client.query(sql, params);
    if (!spec.scalar) return rows;
    const first = rows[0];
    if (!first) return null;
    const keys = Object.keys(first);
    return keys.length ? first[keys[0]] : null;
  }
  // formula
  if (spec.level !== 'template') {
    throw new ComputedError(`formula level "${spec.level}" is not wired yet (declarative-first: template only)`);
  }
  return renderTemplate(spec.expression, args.row, args.ctx);
}

/** Every computed field's backing id + whether it is a scalar (not a list),
 *  gathered from the model so a caller can resolve exactly the backing items it needs. */
export function collectComputedBackings(model: SchemaModel): { backedBy: string; scalar: boolean }[] {
  const out: { backedBy: string; scalar: boolean }[] = [];
  const seen = new Set<string>();
  for (const type of model.types) {
    for (const field of type.fields) {
      if (field.backing.kind === 'computed' && !seen.has(field.backing.backedBy)) {
        seen.add(field.backing.backedBy);
        out.push({ backedBy: field.backing.backedBy, scalar: !field.backing.list });
      }
    }
  }
  return out;
}

/** Build the runComputed lookup map: backedBy id → ComputedSpec. `loadPayload`
 *  resolves a backing item's payload (a datastore `readObjectJson`). Backings that
 *  fail to load/parse are skipped (selecting them then throws at query time — the
 *  same honest failure as before), and their ids are returned in `unresolved`. */
export async function buildComputedMap(
  model: SchemaModel,
  loadPayload: (id: string) => Promise<any> | any,
): Promise<{ map: Map<string, ComputedSpec>; unresolved: string[] }> {
  const map = new Map<string, ComputedSpec>();
  const unresolved: string[] = [];
  for (const { backedBy, scalar } of collectComputedBackings(model)) {
    try {
      const payload = await loadPayload(backedBy);
      if (!payload) { unresolved.push(backedBy); continue; }
      map.set(backedBy, computedSpecFromPayload(payload, scalar));
    } catch {
      unresolved.push(backedBy);
    }
  }
  return { map, unresolved };
}
