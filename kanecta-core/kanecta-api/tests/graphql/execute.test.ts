// End-to-end resolution tests for the generic executor, against an in-memory
// DataSource — no database. Assembles a small discussions graph (thread →
// messages → replies, a file attachment, per-viewer + counted computed fields)
// and resolves GraphQL-shaped selections over it, proving every backing kind.

import { describe, it, expect } from 'vitest';
import { buildSchemaModel } from '../../src/graphql/model.ts';
import { Executor, ExecutionError, type Selection } from '../../src/graphql/execute.ts';
import { MemoryDataSource } from './memory-datasource.ts';
import { allTypes, ids } from './fixtures.ts';

const model = buildSchemaModel(allTypes);

// ── Build a small graph ──────────────────────────────────────────────────────
// Thread T1 has one top-level message M1; M1 has one reply M2 and one file F1.
function makeDb(): MemoryDataSource {
  const db = new MemoryDataSource();

  db.addRow('ChThread', {
    id: 'T1',
    parentId: 'DISCUSSIONS',
    columns: {
      name: 'General',
      created_by_user_id: 'u-alice',
      created_by_name: 'Alice',
      created_at: '2026-01-01T00:00:00Z',
      latest_message_at: '2026-01-03T00:00:00Z',
      sort_order: 1,
    },
  });

  db.addRow('ChMessage', {
    id: 'M1',
    parentId: 'T1', // top-level → parent is the thread
    columns: { thread_id: 'T1', user_id: 'u-alice', user_name: 'Alice', content: 'Hello', created_at: '2026-01-02T00:00:00Z' },
  });
  db.addRow('ChMessage', {
    id: 'M2',
    parentId: 'M1', // reply → parent is the message
    columns: { thread_id: 'T1', user_id: 'u-bob', user_name: 'Bob', content: 'Hi back', created_at: '2026-01-03T00:00:00Z' },
  });

  db.addRow('ChFile', { id: 'F1', parentId: 'M1', columns: { name: 'photo.jpg', mime_type: 'image/jpeg', size_bytes: 1024 } });
  db.addRelationship('M1', 'F1', 'attaches');

  // reply_count = number of ChMessage children of the row.
  db.addComputed(ids.REPLY_COUNT_FN, (row, _viewer, d) => d.children(row.id, 'ChMessage').length);
  // has_unread (per-viewer): unread for alice, read for everyone else.
  db.addComputed(ids.HAS_UNREAD_FN, (_row, viewer) => viewer === 'u-alice');
  db.addComputed(ids.NOTIF_FN, () => false);

  return db;
}

describe('Executor.resolveById', () => {
  const exec = new Executor(model, makeDb());

  it('resolves scalars, containment, nested computed, and a relationship in one query', async () => {
    const selection: Selection = {
      id: true,
      name: true,
      createdByUserId: true,
      messages: { id: true, content: true, replyCount: true, files: { id: true, name: true } },
      hasUnread: true,
    };
    const result = await exec.resolveById('ChThread', 'T1', selection, { viewer: 'u-alice' });
    expect(result).toEqual({
      id: 'T1',
      name: 'General',
      createdByUserId: 'u-alice', // camelCase wire name ← snake column
      messages: [
        { id: 'M1', content: 'Hello', replyCount: 1, files: [{ id: 'F1', name: 'photo.jpg' }] },
      ],
      hasUnread: true,
    });
  });

  it('containment only returns direct children of the parent (M2 is under M1, not T1)', async () => {
    const result = await exec.resolveById('ChThread', 'T1', { messages: { id: true } }, {});
    expect(result).toEqual({ messages: [{ id: 'M1' }] });
  });

  it('resolves replies (message-under-message containment) and an FK reference', async () => {
    // The FK field's wire name is the property name "threadId"; its column
    // thread_id holds the ChThread id, which the executor loads and projects.
    const sel: Selection = { id: true, content: true, replies: { id: true, content: true }, threadId: { id: true, name: true } };
    const result = await exec.resolveById('ChMessage', 'M1', sel, {});
    expect(result).toEqual({
      id: 'M1',
      content: 'Hello',
      replies: [{ id: 'M2', content: 'Hi back' }],
      threadId: { id: 'T1', name: 'General' },
    });
  });

  it('per-viewer computed fields reflect the requesting principal', async () => {
    const alice = await exec.resolveById('ChThread', 'T1', { hasUnread: true }, { viewer: 'u-alice' });
    const bob = await exec.resolveById('ChThread', 'T1', { hasUnread: true }, { viewer: 'u-bob' });
    expect(alice).toEqual({ hasUnread: true });
    expect(bob).toEqual({ hasUnread: false });
  });

  it('returns null for a missing id', async () => {
    expect(await exec.resolveById('ChThread', 'NOPE', { id: true })).toBeNull();
  });

  it('relationship reference with no links resolves to an empty list', async () => {
    // M2 has no attached files.
    const result = await exec.resolveById('ChMessage', 'M2', { id: true, files: { id: true } }, {});
    expect(result).toEqual({ id: 'M2', files: [] });
  });
});

describe('Executor.resolveList', () => {
  const exec = new Executor(model, makeDb());

  it('projects a list under sort/limit', async () => {
    const rows = await exec.resolveList('ChMessage', { sort: [{ field: 'createdAt', direction: 'ASC' }], limit: 10 }, { id: true, userName: true });
    expect(rows).toEqual([
      { id: 'M1', userName: 'Alice' },
      { id: 'M2', userName: 'Bob' },
    ]);
  });

  it('honours DESC ordering', async () => {
    const rows = await exec.resolveList('ChMessage', { sort: [{ field: 'createdAt', direction: 'DESC' }] }, { id: true });
    expect(rows.map((r) => r.id)).toEqual(['M2', 'M1']);
  });
});

describe('Executor errors', () => {
  const exec = new Executor(model, makeDb());

  it('throws on an unknown field', async () => {
    await expect(exec.resolveById('ChThread', 'T1', { nope: true } as any)).rejects.toThrow(ExecutionError);
  });

  it('throws when an object field is selected without a sub-selection', async () => {
    await expect(exec.resolveById('ChThread', 'T1', { messages: true } as any)).rejects.toThrow(/sub-selection/);
  });
});
