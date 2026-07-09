// Tests for the G1 where/sort/pagination → SQL compiler. Pure: assert the
// emitted SQL text and bound parameters; no database. Field names are canonical
// camelCase (the columns are camelCase too — snake_case is only a wire concern).

import { describe, it, expect } from 'vitest';
import { buildSchemaModel } from '../../src/graphql/model.ts';
import { compileSelect, compileOrderBy, compileWhere, compileAggregate, QueryCompileError } from '../../src/graphql/sql-query.ts';
import { allTypes } from './fixtures.ts';

const model = buildSchemaModel(allTypes);
const chThread = model.types.find((t) => t.name === 'ChThread')!;
const chMessage = model.types.find((t) => t.name === 'ChMessage')!;

// Rebuild the column allow-list the way the compiler does, for direct compileWhere tests.
function columnsFor(type: typeof chThread) {
  const map = new Map<string, { column: string; kind: string }>();
  for (const f of type.fields) {
    if (f.backing.kind === 'identity' && f.backing.field === 'id') map.set(f.name, { column: 'item_id', kind: 'id' });
    else if (f.backing.kind === 'scalarColumn' && !f.backing.list) {
      const kind = f.namedType === 'Int' ? 'int' : f.namedType === 'DateTime' ? 'datetime' : f.namedType === 'Boolean' ? 'bool' : f.namedType === 'ID' ? 'id' : 'text';
      map.set(f.name, { column: f.backing.column, kind });
    }
  }
  return map as any;
}

const mkP = () => ({ values: [] as unknown[], next(v: unknown) { this.values.push(v); return `$${this.values.length}`; } });

describe('compileSelect', () => {
  it('emits a parameterised SELECT over the type table with default paging', () => {
    const q = compileSelect(chThread, {});
    expect(q.sql).toBe('SELECT item_id FROM "obj_aaaaaaaa_0000_4000_8000_000000000001" LIMIT $1 OFFSET $2');
    expect(q.params).toEqual([50, 0]);
  });

  it('emits a matching count query without limit/offset', () => {
    const q = compileSelect(chThread, { where: { name: { eq: 'General' } } });
    expect(q.countSql).toBe('SELECT count(*)::int AS total FROM "obj_aaaaaaaa_0000_4000_8000_000000000001" WHERE "name" = $1');
    expect(q.countParams).toEqual(['General']);
  });

  it('binds where + limit/offset in order', () => {
    const q = compileSelect(chThread, { where: { name: { eq: 'General' } }, limit: 10, offset: 20 });
    expect(q.sql).toBe('SELECT item_id FROM "obj_aaaaaaaa_0000_4000_8000_000000000001" WHERE "name" = $1 LIMIT $2 OFFSET $3');
    expect(q.params).toEqual(['General', 10, 20]);
  });

  it('clamps limit to the maximum', () => {
    const q = compileSelect(chThread, { limit: 100000 });
    expect(q.params).toEqual([500, 0]);
  });

  it('composes ORDER BY from the sort arg (camelCase field → snake_case column)', () => {
    const q = compileSelect(chThread, { sort: [{ field: 'sortOrder', direction: 'ASC', nulls: 'LAST' }, { field: 'name', direction: 'ASC' }] });
    expect(q.sql).toContain('ORDER BY "sort_order" ASC NULLS LAST, "name" ASC');
  });

  it('rejects invalid limit/offset', () => {
    expect(() => compileSelect(chThread, { limit: -1 })).toThrow(QueryCompileError);
    expect(() => compileSelect(chThread, { offset: 1.5 })).toThrow(QueryCompileError);
  });
});

describe('compileWhere operators', () => {
  const cols = columnsFor(chThread);

  it('supports equality and inequality', () => {
    const p: any = mkP();
    const clause = compileWhere({ name: { eq: 'x' }, createdByName: { ne: 'y' } }, cols, p);
    expect(clause).toBe('"name" = $1 AND "created_by_name" <> $2');
    expect(p.values).toEqual(['x', 'y']);
  });

  it('supports numeric range operators', () => {
    const p: any = mkP();
    const clause = compileWhere({ sortOrder: { gte: 1, lt: 10 } }, cols, p);
    expect(clause).toBe('"sort_order" >= $1 AND "sort_order" < $2');
    expect(p.values).toEqual([1, 10]);
  });

  it('supports datetime comparisons', () => {
    const p: any = mkP();
    const clause = compileWhere({ createdAt: { gt: '2026-01-01T00:00:00Z' } }, cols, p);
    expect(clause).toBe('"created_at" > $1');
  });

  it('supports IN with an array param', () => {
    const p: any = mkP();
    const clause = compileWhere({ name: { in: ['a', 'b'] } }, cols, p);
    expect(clause).toBe('"name" = ANY($1)');
    expect(p.values).toEqual([['a', 'b']]);
  });

  it('escapes LIKE metacharacters for contains/startsWith', () => {
    const p: any = mkP();
    const clause = compileWhere({ name: { contains: '50%_off' } }, cols, p);
    expect(clause).toBe('"name" ILIKE $1');
    expect(p.values).toEqual(['%50\\%\\_off%']);
  });

  it('supports isNull true/false', () => {
    const p: any = mkP();
    expect(compileWhere({ description: { isNull: true } }, cols, p)).toBe('"description" IS NULL');
    expect(compileWhere({ description: { isNull: false } }, cols, p)).toBe('"description" IS NOT NULL');
  });

  it('compiles and/or/not combinators', () => {
    const p: any = mkP();
    const clause = compileWhere({ or: [{ name: { eq: 'a' } }, { and: [{ name: { eq: 'b' } }, { not: { description: { isNull: true } } }] }] }, cols, p);
    expect(clause).toBe('(("name" = $1) OR ((("name" = $2) AND (NOT ("description" IS NULL)))))');
    expect(p.values).toEqual(['a', 'b']);
  });

  it('maps the id field to item_id', () => {
    const p: any = mkP();
    const clause = compileWhere({ id: { eq: 'uuid-1' } }, cols, p);
    expect(clause).toBe('"item_id" = $1');
  });
});

describe('compileWhere safety (injection boundary)', () => {
  const cols = columnsFor(chThread);

  it('rejects unknown fields (not in the allow-list)', () => {
    expect(() => compileWhere({ 'name; DROP TABLE items': { eq: 'x' } }, cols, mkP() as any)).toThrow(QueryCompileError);
  });

  it('rejects unknown operators', () => {
    expect(() => compileWhere({ name: { evil: 'x' } }, cols, mkP() as any)).toThrow(QueryCompileError);
  });

  it('rejects operators invalid for the column kind', () => {
    // gt is not valid on a text field.
    expect(() => compileWhere({ name: { gt: 'x' } }, cols, mkP() as any)).toThrow(QueryCompileError);
    // contains is not valid on an int field.
    expect(() => compileWhere({ sortOrder: { contains: 'x' } }, cols, mkP() as any)).toThrow(QueryCompileError);
  });

  it('rejects non-filterable (non-scalar) fields like messages/hasUnread', () => {
    expect(() => compileWhere({ messages: { eq: 'x' } }, cols, mkP() as any)).toThrow(QueryCompileError);
    expect(() => compileWhere({ hasUnread: { eq: true } }, cols, mkP() as any)).toThrow(QueryCompileError);
  });
});

describe('compileAggregate (G2)', () => {
  it('compiles a global COUNT(*)', () => {
    const q = compileAggregate(chMessage, { aggregates: [{ fn: 'count', alias: 'total' }] });
    expect(q.sql).toBe('SELECT count(*)::bigint AS "total" FROM "obj_aaaaaaaa_0000_4000_8000_000000000002"');
    expect(q.params).toEqual([]);
  });

  it('compiles a GROUP BY count — the reactions-map / per-thread-count shape', () => {
    const q = compileAggregate(chMessage, { groupBy: ['threadId'], aggregates: [{ fn: 'count', alias: 'n' }] });
    // threadId (wire) → thread_id (column).
    expect(q.sql).toBe('SELECT "thread_id", count(*)::bigint AS "n" FROM "obj_aaaaaaaa_0000_4000_8000_000000000002" GROUP BY "thread_id"');
  });

  it('supports where + multiple aggregates', () => {
    const q = compileAggregate(chThread, {
      where: { sortOrder: { gte: 1 } },
      groupBy: ['createdByUserId'],
      aggregates: [{ fn: 'count', alias: 'threads' }, { fn: 'max', field: 'latestMessageAt', alias: 'newest' }],
    });
    expect(q.sql).toBe('SELECT "created_by_user_id", count(*)::bigint AS "threads", max("latest_message_at") AS "newest" FROM "obj_aaaaaaaa_0000_4000_8000_000000000001" WHERE "sort_order" >= $1 GROUP BY "created_by_user_id"');
    expect(q.params).toEqual([1]);
  });

  it('rejects sum/avg on non-numeric columns and unknown fields', () => {
    expect(() => compileAggregate(chThread, { aggregates: [{ fn: 'sum', field: 'name', alias: 'x' }] })).toThrow(QueryCompileError);
    expect(() => compileAggregate(chThread, { groupBy: ['nope'], aggregates: [{ fn: 'count', alias: 'n' }] })).toThrow(QueryCompileError);
    expect(() => compileAggregate(chThread, { aggregates: [{ fn: 'count', alias: '1bad' }] })).toThrow(QueryCompileError);
  });

  it('sum/avg work on numeric columns', () => {
    const q = compileAggregate(chThread, { aggregates: [{ fn: 'sum', field: 'sortOrder', alias: 's' }, { fn: 'avg', field: 'sortOrder', alias: 'a' }] });
    expect(q.sql).toContain('sum("sort_order") AS "s"');
    expect(q.sql).toContain('avg("sort_order") AS "a"');
  });
});

describe('compileOrderBy', () => {
  const cols = columnsFor(chMessage);

  it('returns empty string for no sort', () => {
    expect(compileOrderBy([], cols)).toBe('');
  });

  it('rejects unknown sort fields', () => {
    expect(() => compileOrderBy([{ field: 'nope' }], cols)).toThrow(QueryCompileError);
  });

  it('rejects non-sortable fields (replyCount is computed)', () => {
    expect(() => compileOrderBy([{ field: 'replyCount' }], cols)).toThrow(QueryCompileError);
  });
});
