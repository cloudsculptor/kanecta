// Tests for the G1 where/sort/pagination → SQL compiler. Pure: assert the
// emitted SQL text and bound parameters; no database.

import { describe, it, expect } from 'vitest';
import { buildSchemaModel } from '../../src/graphql/model.ts';
import { compileSelect, compileOrderBy, QueryCompileError } from '../../src/graphql/sql-query.ts';
import { compileWhere } from '../../src/graphql/sql-query.ts';
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

  it('composes ORDER BY from the sort arg', () => {
    const q = compileSelect(chThread, { sort: [{ field: 'sort_order', direction: 'ASC', nulls: 'LAST' }, { field: 'name', direction: 'ASC' }] });
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
    const p: any = { values: [], next(v: unknown) { this.values.push(v); return `$${this.values.length}`; } };
    const clause = compileWhere({ name: { eq: 'x' }, created_by_name: { ne: 'y' } }, cols, p);
    expect(clause).toBe('"name" = $1 AND "created_by_name" <> $2');
    expect(p.values).toEqual(['x', 'y']);
  });

  it('supports numeric range operators', () => {
    const p: any = { values: [], next(v: unknown) { this.values.push(v); return `$${this.values.length}`; } };
    const clause = compileWhere({ sort_order: { gte: 1, lt: 10 } }, cols, p);
    expect(clause).toBe('"sort_order" >= $1 AND "sort_order" < $2');
    expect(p.values).toEqual([1, 10]);
  });

  it('supports datetime comparisons', () => {
    const p: any = { values: [], next(v: unknown) { this.values.push(v); return `$${this.values.length}`; } };
    const clause = compileWhere({ created_at: { gt: '2026-01-01T00:00:00Z' } }, cols, p);
    expect(clause).toBe('"created_at" > $1');
  });

  it('supports IN with an array param', () => {
    const p: any = { values: [], next(v: unknown) { this.values.push(v); return `$${this.values.length}`; } };
    const clause = compileWhere({ name: { in: ['a', 'b'] } }, cols, p);
    expect(clause).toBe('"name" = ANY($1)');
    expect(p.values).toEqual([['a', 'b']]);
  });

  it('escapes LIKE metacharacters for contains/startsWith', () => {
    const p: any = { values: [], next(v: unknown) { this.values.push(v); return `$${this.values.length}`; } };
    const clause = compileWhere({ name: { contains: '50%_off' } }, cols, p);
    expect(clause).toBe('"name" ILIKE $1');
    expect(p.values).toEqual(['%50\\%\\_off%']);
  });

  it('supports isNull true/false', () => {
    const p: any = { values: [], next(v: unknown) { this.values.push(v); return `$${this.values.length}`; } };
    expect(compileWhere({ description: { isNull: true } }, cols, p)).toBe('"description" IS NULL');
    expect(compileWhere({ description: { isNull: false } }, cols, p)).toBe('"description" IS NOT NULL');
  });

  it('compiles and/or/not combinators', () => {
    const p: any = { values: [], next(v: unknown) { this.values.push(v); return `$${this.values.length}`; } };
    const clause = compileWhere({ or: [{ name: { eq: 'a' } }, { and: [{ name: { eq: 'b' } }, { not: { description: { isNull: true } } }] }] }, cols, p);
    expect(clause).toBe('(("name" = $1) OR ((("name" = $2) AND (NOT ("description" IS NULL)))))');
    expect(p.values).toEqual(['a', 'b']);
  });

  it('maps the id field to item_id', () => {
    const p: any = { values: [], next(v: unknown) { this.values.push(v); return `$${this.values.length}`; } };
    const clause = compileWhere({ id: { eq: 'uuid-1' } }, cols, p);
    expect(clause).toBe('"item_id" = $1');
  });
});

describe('compileWhere safety (injection boundary)', () => {
  const cols = columnsFor(chThread);
  const mkP = () => ({ values: [] as unknown[], next(v: unknown) { this.values.push(v); return `$${this.values.length}`; } });

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
    expect(() => compileWhere({ sort_order: { contains: 'x' } }, cols, mkP() as any)).toThrow(QueryCompileError);
  });

  it('rejects non-filterable (non-scalar) fields like messages/has_unread', () => {
    expect(() => compileWhere({ messages: { eq: 'x' } }, cols, mkP() as any)).toThrow(QueryCompileError);
    expect(() => compileWhere({ has_unread: { eq: true } }, cols, mkP() as any)).toThrow(QueryCompileError);
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

  it('rejects non-sortable fields (reply_count is computed)', () => {
    expect(() => compileOrderBy([{ field: 'reply_count' }], cols)).toThrow(QueryCompileError);
  });
});
