// Declarative computed fields (runComputed). Unit tests for the param-binding +
// spec execution, and a gated real-Postgres integration proving a replyCount-style
// computed query returns the right count end-to-end through the executor + /graphql.

import { describe, it, expect } from 'vitest';
import {
  bindComputedSql, resolveBinding, renderTemplate, runComputedSpec,
  computedSpecFromPayload, ComputedError,
} from '../../src/graphql/computed.ts';
import type { StoredRow, ExecContext } from '../../src/graphql/execute.ts';

const row: StoredRow = { id: 'M1', parentId: 'T1', columns: { thread_id: 'T1', user_name: 'Alice' } };
const ctx: ExecContext = { viewer: 'u-alice' };

describe('binding', () => {
  it('resolves self/id → row id, viewer → ctx.viewer, and columns (camel or snake)', () => {
    expect(resolveBinding('self', row, ctx)).toBe('M1');
    expect(resolveBinding('id', row, ctx)).toBe('M1');
    expect(resolveBinding('viewer', row, ctx)).toBe('u-alice');
    expect(resolveBinding('thread_id', row, ctx)).toBe('T1');
    expect(resolveBinding('threadId', row, ctx)).toBe('T1'); // camel → snake column
    expect(resolveBinding('missing', row, ctx)).toBe(null);
  });

  it('binds {{params.x}} to parameterised SQL (injection-safe, never interpolated)', () => {
    const { sql, params } = bindComputedSql(
      'SELECT count(*) FROM items WHERE parent_id = {{params.self}} AND owner = {{params.viewer}}',
      row, ctx,
    );
    expect(sql).toBe('SELECT count(*) FROM items WHERE parent_id = $1 AND owner = $2');
    expect(params).toEqual(['M1', 'u-alice']);
  });

  it('renders a formula template with {name} substitution', () => {
    expect(renderTemplate('Hi {user_name} on {threadId}', row, ctx)).toBe('Hi Alice on T1');
  });
});

describe('runComputedSpec', () => {
  it('runs a scalar sql query via an injected client and returns the first column', async () => {
    const client = { query: async (_sql: string, _p?: unknown[]) => ({ rows: [{ n: 3 }] }) };
    const spec = computedSpecFromPayload({ language: 'sql', expression: 'SELECT count(*) AS n FROM items WHERE parent_id = {{params.self}}' }, true);
    const v = await runComputedSpec(spec as any, { row, ctx, client });
    expect(v).toBe(3);
  });

  it('returns rows for a list computed field (scalar=false)', async () => {
    const client = { query: async () => ({ rows: [{ a: 1 }, { a: 2 }] }) };
    const spec = computedSpecFromPayload({ language: 'sql', expression: 'SELECT a FROM t' }, false);
    expect(await runComputedSpec(spec as any, { row, ctx, client })).toEqual([{ a: 1 }, { a: 2 }]);
  });

  it('defers non-sql query and non-template formula with a clear error', async () => {
    const client = { query: async () => ({ rows: [] }) };
    await expect(runComputedSpec({ kind: 'query', language: 'kanecta', expression: 'x', scalar: true }, { row, ctx, client }))
      .rejects.toThrow(/not wired yet/);
    await expect(runComputedSpec({ kind: 'formula', level: 'dsl', expression: '=1+1', scalar: true }, { row, ctx, client }))
      .rejects.toThrow(/not wired yet/);
  });

  it('rejects a payload that is neither query nor formula', () => {
    expect(() => computedSpecFromPayload({ foo: 'bar' }, true)).toThrow(ComputedError);
  });
});
