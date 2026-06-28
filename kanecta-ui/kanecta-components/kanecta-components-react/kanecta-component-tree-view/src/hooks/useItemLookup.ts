import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTreeViewContext } from '../context';
import { flattenTree } from '../lib/flattenTree';
import type { KanectaItem } from '../types';

export function useItemLookup(): (id: string) => KanectaItem | undefined {
  const { api, workspaceKey } = useTreeViewContext();

  const { data } = useQuery({
    queryKey: ['all-items', workspaceKey],
    queryFn: () => api.tree.full(),
    staleTime: 10_000,
  });

  return useMemo(() => {
    const map = new Map<string, KanectaItem>();
    if (data) flattenTree(data).forEach((item) => map.set(item.id, item));
    return (id: string) => map.get(id);
  }, [data]);
}
