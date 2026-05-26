import { describe, it, expect } from 'vitest';
import {
  flattenTree,
  filterItems,
  sortItems,
  groupBy,
  itemsOnDate,
} from '../items';
import type { KanectaItem, KanectaItemWithChildren } from '../../types/kanecta';

const makeItem = (overrides: Partial<KanectaItem>): KanectaItem => ({
  id: crypto.randomUUID(),
  value: 'default value',
  type: 'note',
  confidence: 'medium',
  sortOrder: 0,
  tags: [],
  createdAt: new Date().toISOString(),
  modifiedAt: new Date().toISOString(),
  ...overrides,
});

describe('flattenTree', () => {
  it('flattens a nested tree into a flat array', () => {
    const child1 = makeItem({ value: 'child1' });
    const child2 = makeItem({ value: 'child2' });
    const root = {
      ...makeItem({ value: 'root' }),
      children: [
        { ...child1, children: [] },
        { ...child2, children: [] },
      ],
    } as KanectaItemWithChildren;

    const flat = flattenTree([root]);
    expect(flat).toHaveLength(3);
    expect(flat.map((i) => i.value)).toEqual(['root', 'child1', 'child2']);
  });

  it('returns empty for empty tree', () => {
    expect(flattenTree([])).toHaveLength(0);
  });

  it('excludes children property from flat items', () => {
    const root = { ...makeItem({ value: 'root' }), children: [] } as KanectaItemWithChildren;
    const flat = flattenTree([root]);
    expect('children' in flat[0]).toBe(false);
  });
});

describe('filterItems', () => {
  const items = [
    makeItem({ value: 'apple note', type: 'note', confidence: 'high', tags: ['fruit'] }),
    makeItem({ value: 'banana claim', type: 'claim', confidence: 'low', tags: ['fruit', 'food'] }),
    makeItem({ value: 'orange note', type: 'note', confidence: 'high', tags: ['citrus'] }),
  ];

  it('returns all items with empty filter', () => {
    expect(filterItems(items, {})).toHaveLength(3);
  });

  it('filters by type', () => {
    const result = filterItems(items, { type: 'note' });
    expect(result).toHaveLength(1);
    expect(result[0].type).toBe('note');
  });

  it('filters by confidence', () => {
    const result = filterItems(items, { confidence: 'high' });
    expect(result).toHaveLength(2);
  });

  it('filters by search (case-insensitive)', () => {
    expect(filterItems(items, { search: 'APPLE' })).toHaveLength(1);
    expect(filterItems(items, { search: 'an' })).toHaveLength(2);
  });

  it('filters by tags (must have ALL specified tags)', () => {
    expect(filterItems(items, { tags: ['fruit'] })).toHaveLength(2);
    expect(filterItems(items, { tags: ['fruit', 'food'] })).toHaveLength(1);
    expect(filterItems(items, { tags: ['citrus', 'fruit'] })).toHaveLength(0);
  });

  it('combines multiple filter criteria with AND logic', () => {
    const result = filterItems(items, { type: 'note', confidence: 'high' });
    expect(result).toHaveLength(1);
    expect(result[0].value).toBe('apple note');
  });
});

describe('sortItems', () => {
  const items = [
    makeItem({ value: 'banana', sortOrder: 2, confidence: 'high' }),
    makeItem({ value: 'apple', sortOrder: 1, confidence: 'low' }),
    makeItem({ value: 'cherry', sortOrder: 3, confidence: 'verified' }),
  ];

  it('sorts by value ascending', () => {
    const sorted = sortItems(items, { field: 'value', direction: 'asc' });
    expect(sorted.map((i) => i.value)).toEqual(['apple', 'banana', 'cherry']);
  });

  it('sorts by value descending', () => {
    const sorted = sortItems(items, { field: 'value', direction: 'desc' });
    expect(sorted.map((i) => i.value)).toEqual(['cherry', 'banana', 'apple']);
  });

  it('sorts by sortOrder', () => {
    const sorted = sortItems(items, { field: 'sortOrder', direction: 'asc' });
    expect(sorted.map((i) => i.sortOrder)).toEqual([1, 2, 3]);
  });

  it('sorts by confidence (low < medium < high < verified < locked)', () => {
    const sorted = sortItems(items, { field: 'confidence', direction: 'asc' });
    expect(sorted.map((i) => i.confidence)).toEqual(['low', 'high', 'verified']);
  });

  it('does not mutate the input array', () => {
    const original = [...items];
    sortItems(items, { field: 'value', direction: 'desc' });
    expect(items).toEqual(original);
  });
});

describe('groupBy', () => {
  const items = [
    makeItem({ type: 'note', confidence: 'high' }),
    makeItem({ type: 'note', confidence: 'low' }),
    makeItem({ type: 'claim', confidence: 'high' }),
  ];

  it('groups items by a key function', () => {
    const grouped = groupBy(items, (i) => i.type);
    expect(grouped.get('note')).toHaveLength(2);
    expect(grouped.get('claim')).toHaveLength(1);
  });

  it('returns empty map for empty input', () => {
    expect(groupBy([], (i) => i.type).size).toBe(0);
  });
});

describe('itemsOnDate', () => {
  const items = [
    makeItem({ createdAt: '2024-03-15T10:00:00Z' }),
    makeItem({ createdAt: '2024-03-15T23:59:00Z' }),
    makeItem({ createdAt: '2024-03-16T00:01:00Z' }),
    makeItem({ createdAt: '2024-04-01T12:00:00Z' }),
  ];

  it('returns items matching the given date', () => {
    expect(itemsOnDate(items, 2024, 2, 15)).toHaveLength(2);
  });

  it('returns empty for a date with no items', () => {
    expect(itemsOnDate(items, 2024, 2, 14)).toHaveLength(0);
  });

  it('correctly handles month 0-based index', () => {
    expect(itemsOnDate(items, 2024, 3, 1)).toHaveLength(1);
  });
});
