// The graphql-js wiring: real GraphQL operations executed end-to-end against the
// in-memory DataSource (no database, no HTTP). Proves the SDL builds, root
// resolvers dispatch to the executor, the resolve-info → Selection conversion is
// correct (nested objects, aliases, fragments, variables), G1 args pass through,
// the authz gate applies, and a computed field on an unwired DataSource surfaces
// as a GraphQL error rather than crashing the request.

import { describe, it, expect } from 'vitest';
import { buildSchemaModel } from '../../src/graphql/model.ts';
import { buildGraphqlEngine } from '../../src/graphql/http.ts';
import { MemoryDataSource } from './memory-datasource.ts';
import { allTypes, ids } from './fixtures.ts';

const model = buildSchemaModel(allTypes);

function makeDb(): MemoryDataSource {
  const db = new MemoryDataSource();
  db.addRow('ChThread', {
    id: 'T1', parentId: 'DISCUSSIONS',
    columns: { name: 'General', created_by_user_id: 'u-alice', created_by_name: 'Alice', created_at: '2026-01-01T00:00:00Z', latest_message_at: '2026-01-03T00:00:00Z', sort_order: 1 },
  });
  db.addRow('ChThread', {
    id: 'T2', parentId: 'DISCUSSIONS',
    columns: { name: 'Random', created_by_user_id: 'u-bob', created_by_name: 'Bob', created_at: '2026-01-02T00:00:00Z', latest_message_at: '2026-01-02T00:00:00Z', sort_order: 2 },
  });
  db.addRow('ChMessage', { id: 'M1', parentId: 'T1', columns: { thread_id: 'T1', user_id: 'u-alice', user_name: 'Alice', content: 'Hello', created_at: '2026-01-02T00:00:00Z' } });
  db.addRow('ChMessage', { id: 'M2', parentId: 'M1', columns: { thread_id: 'T1', user_id: 'u-bob', user_name: 'Bob', content: 'Hi back', created_at: '2026-01-03T00:00:00Z' } });
  db.addRow('ChFile', { id: 'F1', parentId: 'M1', columns: { name: 'photo.jpg', mime_type: 'image/jpeg', size_bytes: 1024 } });
  db.addRelationship('M1', 'F1', 'attaches');
  db.addComputed(ids.REPLY_COUNT_FN, (row, _viewer, d) => d.children(row.id, 'ChMessage').length);
  db.addComputed(ids.HAS_UNREAD_FN, (_row, viewer) => viewer === 'u-alice');
  db.addComputed(ids.NOTIF_FN, () => false);
  return db;
}

const engine = buildGraphqlEngine(model, makeDb());

describe('buildGraphqlEngine', () => {
  it('emits a Query type with singular + list fields per model type', () => {
    expect(engine.sdl).toContain('type Query {');
    expect(engine.sdl).toMatch(/chThread\(id: ID!\): ChThread/);
    expect(engine.sdl).toMatch(/chThreads\(/);
  });

  it('resolves a singular query with nested containment + relationship', async () => {
    const result = await engine.execute({
      source: `{ chThread(id: "T1") { id name messages { id content files { name } } } }`,
    });
    expect(result.errors).toBeUndefined();
    expect(result.data).toEqual({
      chThread: { id: 'T1', name: 'General', messages: [{ id: 'M1', content: 'Hello', files: [{ name: 'photo.jpg' }] }] },
    });
  });

  it('honours field aliases', async () => {
    const result = await engine.execute({ source: `{ t: chThread(id: "T1") { key: id title: name } }` });
    expect(result.errors).toBeUndefined();
    expect(result.data).toEqual({ t: { key: 'T1', title: 'General' } });
  });

  it('expands fragments (spread + inline)', async () => {
    const result = await engine.execute({
      source: `
        query { chThread(id: "T1") { ...F ... on ChThread { name } } }
        fragment F on ChThread { id }
      `,
    });
    expect(result.errors).toBeUndefined();
    expect(result.data).toEqual({ chThread: { id: 'T1', name: 'General' } });
  });

  it('passes G1 where/sort/limit args through variables', async () => {
    const result = await engine.execute({
      source: `query($w: ChThreadWhere, $s: [ChThreadSort!]) { chThreads(where: $w, sort: $s, limit: 5) { id name } }`,
      variableValues: { w: { name: { contains: 'a' } }, s: [{ field: 'sortOrder', direction: 'DESC' }] },
    });
    expect(result.errors).toBeUndefined();
    // Both "General" and "Random" contain 'a'; DESC by sortOrder → T2 then T1.
    expect((result.data as any).chThreads.map((t: any) => t.id)).toEqual(['T2', 'T1']);
  });

  it('applies the authz read gate from context', async () => {
    const denied = new Set(['T1']);
    const result = await engine.execute({
      source: `{ chThreads { id } }`,
      context: { authorize: (id: string) => !denied.has(id) },
    });
    expect(result.errors).toBeUndefined();
    expect((result.data as any).chThreads.map((t: any) => t.id)).toEqual(['T2']);
  });

  it('threads the per-viewer context into computed fields', async () => {
    const asAlice = await engine.execute({ source: `{ chThread(id: "T1") { hasUnread } }`, context: { viewer: 'u-alice' } });
    expect((asAlice.data as any).chThread.hasUnread).toBe(true);
    const asBob = await engine.execute({ source: `{ chThread(id: "T1") { hasUnread } }`, context: { viewer: 'u-bob' } });
    expect((asBob.data as any).chThread.hasUnread).toBe(false);
  });

  it('returns a GraphQL error (not a crash) when a computed field has no runner', async () => {
    // A DataSource whose runComputed throws (the PgDataSource state today).
    const noRunner = makeDb();
    (noRunner as any).runComputed = () => { throw new Error('runner not wired'); };
    const eng = buildGraphqlEngine(model, noRunner);
    const result = await eng.execute({ source: `{ chThread(id: "T1") { id hasUnread } }` });
    expect(result.errors).toBeTruthy();
    expect(result.errors![0].message).toContain('runner not wired');
  });
});
