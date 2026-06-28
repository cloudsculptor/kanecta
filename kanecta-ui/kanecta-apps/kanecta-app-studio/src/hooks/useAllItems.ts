import { useQuery } from '@tanstack/react-query';
import { useWorkspaceStore } from '../store/workspace';
import { useUiStore } from '../store/ui';
import { flattenTree, filterItems, sortItems } from '../lib/items';
import type { FilterState, SortState } from '../types/ui';

const DEFAULT_SORT: SortState = { field: 'sortOrder', direction: 'asc' };

export function useAllItems(panelId: string, workspaceId?: string) {
  const { getApi, activeWorkspaceId } = useWorkspaceStore();
  const { filtersByPanel, sortsByPanel } = useUiStore();
  const wsId = workspaceId ?? activeWorkspaceId;
  const api = getApi(wsId);

  const filter: FilterState = filtersByPanel[panelId] ?? {};
  const sort: SortState = sortsByPanel[panelId] ?? DEFAULT_SORT;

  const query = useQuery({
    queryKey: ['all-items', wsId],
    queryFn: () => api.tree.full(),
    staleTime: 10_000,
  });

  const allFlat = query.data ? flattenTree(query.data) : [];
  const filtered = filterItems(allFlat, filter);
  const sorted = sortItems(filtered, sort);

  return { items: sorted, isLoading: query.isLoading, error: query.error, filter, sort };
}
