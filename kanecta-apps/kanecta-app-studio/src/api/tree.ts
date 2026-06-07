import type { KanectaApiClient } from '@kanecta/api-client';
import type { KanectaItem, KanectaItemWithChildren } from '../types/kanecta';

type TreeEntry = { item: KanectaItem; depth: number };

function entriesToNested(entries: TreeEntry[]): KanectaItemWithChildren[] {
  const roots: KanectaItemWithChildren[] = [];
  const stack: Array<{ node: KanectaItemWithChildren; depth: number }> = [];

  for (const { item, depth } of entries) {
    const node: KanectaItemWithChildren = { ...item, children: [], childCount: 0 };

    while (stack.length > 0 && stack[stack.length - 1].depth >= depth) {
      stack.pop();
    }

    if (stack.length === 0) {
      roots.push(node);
    } else {
      stack[stack.length - 1].node.children.push(node);
    }

    stack.push({ node, depth });
  }

  const setCount = (node: KanectaItemWithChildren): number => {
    node.childCount = node.children.reduce((s, c) => s + 1 + setCount(c), 0);
    return node.childCount;
  };
  roots.forEach(setCount);

  return roots;
}

export function treeApi(client: KanectaApiClient) {
  return {
    full: async (depth?: number): Promise<KanectaItemWithChildren[]> => {
      const entries = (await client.tree.get(depth)) as TreeEntry[];
      return entriesToNested(Array.isArray(entries) ? entries : []);
    },

    rebuildIndexes: () => client.rebuildIndexes(),
  };
}
