import type { ViewMeta } from '../../../lib/viewMeta';
import { useViewLocation } from '../../../context/LocationContext';
import { GraphView as GraphViewPkg } from '@kanecta/component-graph-view';
import { useWorkingSetStore } from '../../../store/workingSet';
import { useUiStore } from '../../../store/ui';
import { flattenTree } from '../../../lib/items';

export const GraphViewMeta: ViewMeta = {
  uuid: 'c0b9d8e7-f1a2-4b3c-4d5e-6f7a8b9c0d1e',
  name: 'graph',
  label: 'Graph',
  icon: 'BubbleChart',
};

export function GraphView() {
  useViewLocation(GraphViewMeta.uuid);
  const { getApi, getActiveWorkingSet } = useWorkingSetStore();
  const { focusedItemId, setFocusedItem } = useUiStore();
  const wsId = getActiveWorkingSet()?.id ?? '';
  const api = getApi();

  return (
    <GraphViewPkg
      onFetchItems={async () => {
        const items = flattenTree(await api.tree.full());
        return items.map((i) => ({
          id: i.id,
          value: i.value,
          type: i.type,
          confidence: i.confidence ?? undefined,
          parentId: i.parentId ?? null,
          childCount: i.childCount,
        }));
      }}
      onFetchRelationships={() => api.relationships.list()}
      focusedItemId={focusedItemId}
      onFocusItem={setFocusedItem}
      queryKey={wsId}
    />
  );
}
