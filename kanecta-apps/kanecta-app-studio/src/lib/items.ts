import type { KanectaItem, KanectaItemWithChildren } from '../types/kanecta';
import type { FilterState, SortState } from '../types/ui';

export function flattenTree(nodes: KanectaItemWithChildren[]): KanectaItem[] {
  const result: KanectaItem[] = [];
  const walk = (list: KanectaItemWithChildren[]) => {
    for (const node of list) {
      const { children, ...item } = node;
      result.push(item as KanectaItem);
      if (children?.length) walk(children);
    }
  };
  walk(nodes);
  return result;
}

export function filterItems(items: KanectaItem[], filter: FilterState): KanectaItem[] {
  return items.filter((item) => {
    if (filter.type && item.type !== filter.type) return false;
    if (filter.confidence && item.confidence !== filter.confidence) return false;
    if (filter.tags?.length) {
      const hasAll = filter.tags.every((t) => item.tags.includes(t));
      if (!hasAll) return false;
    }
    if (filter.search) {
      const q = filter.search.toLowerCase();
      if (!item.value.toLowerCase().includes(q)) return false;
    }
    return true;
  });
}

const CONFIDENCE_ORDER = ['low', 'medium', 'high', 'verified', 'locked'];

export function sortItems(items: KanectaItem[], sort: SortState): KanectaItem[] {
  return [...items].sort((a, b) => {
    let cmp = 0;
    if (sort.field === 'confidence') {
      cmp = CONFIDENCE_ORDER.indexOf(a.confidence) - CONFIDENCE_ORDER.indexOf(b.confidence);
    } else if (sort.field === 'value') {
      cmp = a.value.localeCompare(b.value);
    } else if (sort.field === 'sortOrder') {
      cmp = a.sortOrder - b.sortOrder;
    } else {
      const aVal = a[sort.field] ?? '';
      const bVal = b[sort.field] ?? '';
      cmp = String(aVal).localeCompare(String(bVal));
    }
    return sort.direction === 'desc' ? -cmp : cmp;
  });
}

export function groupBy<K extends string>(
  items: KanectaItem[],
  key: (item: KanectaItem) => K,
): Map<K, KanectaItem[]> {
  const map = new Map<K, KanectaItem[]>();
  for (const item of items) {
    const k = key(item);
    if (!map.has(k)) map.set(k, []);
    map.get(k)!.push(item);
  }
  return map;
}

export function groupByConfidence(items: KanectaItem[]) {
  return groupBy(items, (i) => i.confidence);
}

export function groupByType(items: KanectaItem[]) {
  return groupBy(items, (i) => i.type);
}

export function itemsOnDate(items: KanectaItem[], year: number, month: number, day: number) {
  const prefix = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  return items.filter((i) => i.createdAt?.startsWith(prefix));
}
