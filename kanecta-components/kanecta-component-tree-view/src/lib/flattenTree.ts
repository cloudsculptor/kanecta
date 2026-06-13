import type { KanectaItem, KanectaItemWithChildren } from '../types';

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
