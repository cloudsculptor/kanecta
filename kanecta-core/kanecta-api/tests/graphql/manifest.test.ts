// End-to-end over the REAL community-hub discussions manifest: build the schema
// from the authored type files, derive each type's Postgres DDL via the compiler,
// and resolve a query with the generic executor. Proves the vocabulary + engine
// work on actual cutover types, not just inline fixtures.

import { describe, it, expect } from 'vitest';
import { deriveSqlSchema } from '@kanecta/schema-compiler';
import { buildSchemaModel, emitSDL } from '../../src/graphql/index.ts';
import { Executor, type Selection } from '../../src/graphql/execute.ts';
import { MemoryDataSource } from './memory-datasource.ts';
import chThread from '../../manifests/community-hub/ch-thread.type.json' with { type: 'json' };
import chMessage from '../../manifests/community-hub/ch-message.type.json' with { type: 'json' };
import chFile from '../../manifests/community-hub/ch-file.type.json' with { type: 'json' };

const types = [chThread, chMessage, chFile];
const model = buildSchemaModel(types);

describe('community-hub manifest → schema', () => {
  it('builds a clean schema for the discussions slice', () => {
    expect(model.diagnostics.filter((d) => d.level === 'error')).toEqual([]);
    expect(model.types.map((t) => t.name).sort()).toEqual(['ChFile', 'ChMessage', 'ChThread']);
  });

  it('wires containment, FK reference, relationship and computed fields', () => {
    const thread = model.types.find((t) => t.name === 'ChThread')!;
    expect(thread.fields.find((f) => f.name === 'messages')!.backing).toMatchObject({ kind: 'containment', targetTypeName: 'ChMessage' });
    expect(thread.fields.find((f) => f.name === 'hasUnread')!.backing).toMatchObject({ kind: 'computed', scope: 'perViewer' });

    const message = model.types.find((t) => t.name === 'ChMessage')!;
    expect(message.fields.find((f) => f.name === 'threadId')!.backing).toMatchObject({ kind: 'reference', targetTypeName: 'ChThread', column: 'thread_id' });
    expect(message.fields.find((f) => f.name === 'files')!.backing).toMatchObject({ kind: 'reference', relationshipType: 'attaches' });
  });

  it('keeps camelCase on the wire and hides soft-delete columns', () => {
    const thread = model.types.find((t) => t.name === 'ChThread')!;
    const names = thread.fields.map((f) => f.name);
    expect(names).toContain('createdByUserId');
    expect(names).not.toContain('archivedAt'); // expose:false
  });

  it('emits SDL with the discussions root queries', () => {
    const sdl = emitSDL(model);
    expect(sdl).toMatch(/chThread\(id: ID!\): ChThread/);
    expect(sdl).toMatch(/chMessages\(where: ChMessageWhere/);
    expect(sdl).toMatch(/messages: \[ChMessage!\]!/);
  });
});

describe('community-hub manifest → Postgres DDL (compiler)', () => {
  it('derives snake_case columns from camelCase fields, keeping stored-but-hidden columns', () => {
    const [ddl] = deriveSqlSchema((chThread as any).payload.jsonSchema, { typeId: chThread.item.id, dialect: 'postgres' });
    expect(ddl).toMatch(/"created_by_user_id" TEXT/);
    expect(ddl).toMatch(/"latest_message_at" TEXT/);
    expect(ddl).toMatch(/"sort_order" BIGINT/);
    // archivedAt is expose:false for GraphQL but still a real stored column.
    expect(ddl).toMatch(/"archived_at" TEXT/);
    // The engine's backing column agrees with the compiler's DDL.
    const thread = model.types.find((t) => t.name === 'ChThread')!;
    const col = (thread.fields.find((f) => f.name === 'createdByUserId')!.backing as any).column;
    expect(ddl).toContain(`"${col}"`);
  });

  it('emits a plain UUID column for the typeId reference (no FK under item_archive)', () => {
    const [ddl] = deriveSqlSchema((chMessage as any).payload.jsonSchema, { typeId: chMessage.item.id, dialect: 'postgres' });
    // Reference columns carry no FK: a reference may legitimately point at an
    // ARCHIVED item (soft delete physically moves the row out of items), and
    // one FK cannot span items ∪ item_archive — union integrity is the
    // integrity checker's job.
    expect(ddl).toMatch(/"thread_id" UUID/);
    expect(ddl).not.toMatch(/"thread_id" UUID REFERENCES/);
  });
});

describe('community-hub manifest → executor', () => {
  function makeDb(): MemoryDataSource {
    const db = new MemoryDataSource();
    db.addRow('ChThread', { id: 'T1', parentId: 'DISC', columns: { name: 'General', created_by_user_id: 'u-alice', latest_message_at: '2026-01-03T00:00:00Z' } });
    db.addRow('ChMessage', { id: 'M1', parentId: 'T1', columns: { thread_id: 'T1', user_name: 'Alice', content: 'Hello' } });
    db.addRow('ChMessage', { id: 'M2', parentId: 'M1', columns: { thread_id: 'T1', user_name: 'Bob', content: 'Reply' } });
    db.addRow('ChFile', { id: 'F1', parentId: 'M1', columns: { name: 'a.png', mime_type: 'image/png', size_bytes: 10 } });
    db.addRelationship('M1', 'F1', 'attaches');
    db.addComputed('0c8a7b10-1111-4a00-8000-000000000203', (row, _v, d) => d.children(row.id, 'ChMessage').length);
    db.addComputed('0c8a7b10-1111-4a00-8000-000000000201', (_row, viewer) => viewer === 'u-alice');
    db.addComputed('0c8a7b10-1111-4a00-8000-000000000202', () => false);
    return db;
  }

  it('resolves a nested thread → messages → files/replyCount query with per-viewer flags', async () => {
    const exec = new Executor(model, makeDb());
    const selection: Selection = {
      id: true,
      name: true,
      hasUnread: true,
      messages: { id: true, content: true, replyCount: true, files: { name: true } },
    };
    const result = await exec.resolveById('ChThread', 'T1', selection, { viewer: 'u-alice' });
    expect(result).toEqual({
      id: 'T1',
      name: 'General',
      hasUnread: true,
      messages: [{ id: 'M1', content: 'Hello', replyCount: 1, files: [{ name: 'a.png' }] }],
    });
  });
});
