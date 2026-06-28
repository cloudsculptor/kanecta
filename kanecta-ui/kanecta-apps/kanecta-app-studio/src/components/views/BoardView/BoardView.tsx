import type { ViewMeta } from '../../../lib/viewMeta';
import { useViewLocation } from '../../../context/LocationContext';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { BoardView as BoardViewPkg } from '@kanecta/component-board-view';
import { useAllItems } from '../../../hooks/useAllItems';
import { useUiStore } from '../../../store/ui';
import { useWorkspaceStore } from '../../../store/workspace';
import { ITEM_TYPES, CONFIDENCE_LEVELS } from '../../../lib/constants';

export const BoardViewMeta: ViewMeta = {
  uuid: 'e6d5f4a3-b7c8-4d9e-0f1a-2b3c4d5e6f7a',
  name: 'board',
  label: 'Board',
  icon: 'ViewKanban',
};

interface BoardViewProps {
  panelId: string;
}

export function BoardView({ panelId }: BoardViewProps) {
  useViewLocation(BoardViewMeta.uuid);
  const { items, isLoading, filter } = useAllItems(panelId);
  const { setPanelFilter, setFocusedItem, focusedItemId } = useUiStore();
  const { getApi } = useWorkspaceStore();
  const qc = useQueryClient();

  const updateMutation = useMutation({
    mutationFn: ({ id, changes }: { id: string; changes: Record<string, unknown> }) =>
      getApi().items.update(id, changes),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['all-items'] }),
  });

  const handleMoveToGroup = (id: string, field: 'confidence' | 'type', value: string) => {
    updateMutation.mutate({ id, changes: { [field]: value } });
  };

  return (
    <BoardViewPkg
      items={items}
      isLoading={isLoading}
      filter={filter}
      onFilterChange={(f) => setPanelFilter(panelId, f)}
      onMoveToGroup={handleMoveToGroup}
      selectedId={focusedItemId}
      onSelect={setFocusedItem}
      itemTypes={ITEM_TYPES}
      confidenceLevels={CONFIDENCE_LEVELS}
      panelId={panelId}
    />
  );
}
