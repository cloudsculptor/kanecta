import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useWorkspaceStore } from '../store/workspace';
import { flattenTree } from '../lib/items';
import type { KanectaItem } from '../types/kanecta';

export function useItemLookup(workspaceId?: string): (id: string) => KanectaItem | undefined {
  const { getApi, activeWorkspaceId } = useWorkspaceStore();
  const wsId = workspaceId ?? activeWorkspaceId;

  const { data } = useQuery({
    queryKey: ['all-items', wsId],
    queryFn: () => getApi(wsId).tree.full(),
    staleTime: 10_000,
  });

  return useMemo(() => {
    const map = new Map<string, KanectaItem>();
    if (data) flattenTree(data).forEach((item) => map.set(item.id, item));
    return (id: string) => map.get(id);
  }, [data]);
}
