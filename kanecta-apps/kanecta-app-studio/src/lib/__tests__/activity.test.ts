import { describe, it, expect, vi } from 'vitest';
import { diffItems, buildItemMap } from '../activity';
import type { KanectaItem } from '../../types/kanecta';

function makeItem(id: string, modifiedAt = '2024-01-01T00:00:00Z'): KanectaItem {
  return { id, value: `Item ${id}`, type: 'note', confidence: 'medium', sortOrder: 0, tags: [], createdAt: '2024-01-01T00:00:00Z', modifiedAt };
}

describe('buildItemMap', () => {
  it('creates a map keyed by id', () => {
    const items = [makeItem('a'), makeItem('b')];
    const map = buildItemMap(items);
    expect(map.size).toBe(2);
    expect(map.get('a')).toBe(items[0]);
    expect(map.get('b')).toBe(items[1]);
  });

  it('returns empty map for empty array', () => {
    expect(buildItemMap([]).size).toBe(0);
  });
});

describe('diffItems', () => {
  beforeEach(() => {
    vi.spyOn(global, 'crypto', 'get').mockReturnValue({
      randomUUID: () => 'test-uuid',
    } as Crypto);
  });

  it('marks new items as created', () => {
    const current = [makeItem('a'), makeItem('b')];
    const events = diffItems('ws-1', new Map(), current);
    expect(events).toHaveLength(2);
    expect(events.every((e) => e.operation === 'created')).toBe(true);
    expect(events.every((e) => e.workspaceId === 'ws-1')).toBe(true);
  });

  it('marks items with changed modifiedAt as modified', () => {
    const original = makeItem('a', '2024-01-01T00:00:00Z');
    const updated = makeItem('a', '2024-01-02T00:00:00Z');
    const prev = buildItemMap([original]);
    const events = diffItems('ws-1', prev, [updated]);
    expect(events).toHaveLength(1);
    expect(events[0].operation).toBe('modified');
    expect(events[0].item.id).toBe('a');
  });

  it('produces no events for unchanged items', () => {
    const item = makeItem('a');
    const prev = buildItemMap([item]);
    const events = diffItems('ws-1', prev, [item]);
    expect(events).toHaveLength(0);
  });

  it('produces created and modified events together', () => {
    const existing = makeItem('a', '2024-01-01T00:00:00Z');
    const existingUpdated = makeItem('a', '2024-01-02T00:00:00Z');
    const brand = makeItem('b');
    const prev = buildItemMap([existing]);
    const events = diffItems('ws-1', prev, [existingUpdated, brand]);
    const ops = events.map((e) => e.operation);
    expect(ops).toContain('created');
    expect(ops).toContain('modified');
  });

  it('includes workspaceId in every event', () => {
    const events = diffItems('ws-42', new Map(), [makeItem('x')]);
    expect(events.every((e) => e.workspaceId === 'ws-42')).toBe(true);
  });
});
