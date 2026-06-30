import { describe, it, expect } from 'vitest';
import { buildDigest } from '../digest';
import type { KanectaItem } from '../../types/kanecta';
import type { ActivityEvent } from '../../types/workingSet';

function makeItem(id: string, parentId?: string): KanectaItem {
  return { id, value: `Item ${id}`, type: 'note', confidence: 'medium', sortOrder: 0, tags: [], parentId, createdAt: '', modifiedAt: '' };
}

function makeEvent(id: string, item: KanectaItem, operation: ActivityEvent['operation'], seenAt: string): ActivityEvent {
  return { id, workingSetId: 'ws-1', item, operation, seenAt };
}

const parent = makeItem('parent');
const childA = makeItem('child-a', 'parent');
const childB = makeItem('child-b', 'parent');
const orphan = makeItem('orphan');

describe('buildDigest', () => {
  it('returns empty digest for no events', () => {
    const digest = buildDigest([], [], 0, 0);
    expect(digest.totalEvents).toBe(0);
    expect(digest.groups).toHaveLength(0);
    expect(digest.lastActiveAt).toBeNull();
  });

  it('groups events by parentId', () => {
    const events = [
      makeEvent('e1', childA, 'created', '2024-01-01T10:00:00Z'),
      makeEvent('e2', childB, 'modified', '2024-01-01T11:00:00Z'),
      makeEvent('e3', orphan, 'created', '2024-01-01T12:00:00Z'),
    ];
    const digest = buildDigest(events, [parent, childA, childB, orphan], 0, 0);
    expect(digest.groups).toHaveLength(2);
    const parentGroup = digest.groups.find((g) => g.parentId === 'parent');
    expect(parentGroup?.events).toHaveLength(2);
    const rootGroup = digest.groups.find((g) => g.parentId === null);
    expect(rootGroup?.events).toHaveLength(1);
  });

  it('uses parent item value as group label', () => {
    const events = [makeEvent('e1', childA, 'created', '2024-01-01T10:00:00Z')];
    const digest = buildDigest(events, [parent, childA], 0, 0);
    const group = digest.groups.find((g) => g.parentId === 'parent');
    expect(group?.parentValue).toBe('Item parent');
  });

  it('uses (root) label for orphaned items', () => {
    const events = [makeEvent('e1', orphan, 'created', '2024-01-01T10:00:00Z')];
    const digest = buildDigest(events, [orphan], 0, 0);
    expect(digest.groups[0].parentValue).toBe('(root)');
  });

  it('counts created and modified separately', () => {
    const events = [
      makeEvent('e1', childA, 'created', '2024-01-01T10:00:00Z'),
      makeEvent('e2', childB, 'created', '2024-01-01T10:30:00Z'),
      makeEvent('e3', childA, 'modified', '2024-01-01T11:00:00Z'),
    ];
    const digest = buildDigest(events, [parent, childA, childB], 0, 0);
    const group = digest.groups.find((g) => g.parentId === 'parent');
    expect(group?.createdCount).toBe(2);
    expect(group?.modifiedCount).toBe(1);
  });

  it('sets totalEvents and passthrough counts', () => {
    const events = [makeEvent('e1', childA, 'created', '2024-01-01T10:00:00Z')];
    const digest = buildDigest(events, [parent, childA], 3, 7);
    expect(digest.totalEvents).toBe(1);
    expect(digest.conflictCount).toBe(3);
    expect(digest.reviewBacklogCount).toBe(7);
  });

  it('sets lastActiveAt to the latest seenAt', () => {
    const events = [
      makeEvent('e1', childA, 'created', '2024-01-01T10:00:00Z'),
      makeEvent('e2', childB, 'created', '2024-01-01T15:00:00Z'),
      makeEvent('e3', orphan, 'modified', '2024-01-01T12:00:00Z'),
    ];
    const digest = buildDigest(events, [parent, childA, childB, orphan], 0, 0);
    expect(digest.lastActiveAt).toBe('2024-01-01T15:00:00Z');
  });

  it('sorts groups by latest event descending', () => {
    const events = [
      makeEvent('e1', childA, 'created', '2024-01-01T08:00:00Z'),
      makeEvent('e2', orphan, 'created', '2024-01-01T20:00:00Z'),
    ];
    const digest = buildDigest(events, [parent, childA, orphan], 0, 0);
    expect(digest.groups[0].parentId).toBeNull();
    expect(digest.groups[1].parentId).toBe('parent');
  });
});
