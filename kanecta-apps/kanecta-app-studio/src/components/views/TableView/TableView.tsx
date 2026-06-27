import type { ViewMeta } from '../../../lib/viewMeta';
import { useViewLocation } from '../../../context/LocationContext';
import { TableView as TableViewPkg } from '@kanecta/component-table-view';
import { useWorkspaceStore } from '../../../store/workspace';
import { flattenTree } from '../../../lib/items';
import type { ItemType } from '../../../types/kanecta';

export const TableViewMeta: ViewMeta = {
  uuid: 'c4b3d2e1-f5a6-4b7c-8d9e-0f1a2b3c4d5e',
  name: 'table',
  label: 'Table',
  icon: 'TableChart',
};

export function TableView() {
  useViewLocation(TableViewMeta.uuid);
  const { getApi, activeWorkspaceId } = useWorkspaceStore();
  const api = getApi();

  return (
    <TableViewPkg
      onFetchTypes={() => api.types.list()}
      onFetchStats={() => api.items.stats()}
      onFetchItems={async () => {
        const tree = await api.tree.full();
        return flattenTree(tree).map((i) => ({ id: i.id, typeId: i.typeId ?? null }));
      }}
      onFetchSchema={(typeId) => api.types.schema(typeId)}
      onFetchObjects={(ids) =>
        Promise.all(ids.map((id) => api.items.getObject(id).catch(() => ({}))))
      }
      onCreateItem={(type) =>
        api.items.create({ value: `New ${type.value}`, type: type.value as ItemType })
      }
      queryKey={activeWorkspaceId ?? ''}
    />
  );
}
