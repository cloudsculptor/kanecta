import { useQuery } from '@tanstack/react-query';
import { useWorkingSetStore } from '../store/workingSet';
import { useUiStore } from '../store/ui';
import { flattenTree, filterItems, sortItems } from '../lib/items';
import type { FilterState, SortState } from '../types/ui';

const DEFAULT_SORT: SortState = { field: 'sortOrder', direction: 'asc' };

export function useAllItems(panelId: string, workingSetId?: string) {
  const { getApi, activeWorkingSetId } = useWorkingSetStore();
  const { filtersByPanel, sortsByPanel } = useUiStore();
  const wsId = workingSetId ?? activeWorkingSetId;
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
