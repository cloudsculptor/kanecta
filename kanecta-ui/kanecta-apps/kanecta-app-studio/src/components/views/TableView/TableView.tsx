import type { ViewMeta } from '../../../lib/viewMeta';
import { useViewLocation } from '../../../context/LocationContext';
import { TableView as TableViewPkg } from '@kanecta/component-table-view';
import { useWorkingSetStore } from '../../../store/workingSet';
import type { ItemType } from '../../../types/kanecta';

export const TableViewMeta: ViewMeta = {
  uuid: 'c4b3d2e1-f5a6-4b7c-8d9e-0f1a2b3c4d5e',
  name: 'table',
  label: 'Table',
  icon: 'TableChart',
};

export function TableView() {
  useViewLocation(TableViewMeta.uuid);
  const { getApi, getActiveWorkingSet, activeWorkingSetId } = useWorkingSetStore();
  const api = getApi();
  const apiUrl = getActiveWorkingSet()?.apiUrl ?? '/api';

  return (
    <TableViewPkg
      onFetchTypes={() => api.types.list()}
      onFetchStats={() => api.items.stats()}
      onFetchItemsByType={(typeId) =>
        fetch(`${apiUrl}/items`, {
          headers: { Accept: `application/json; type=${typeId}` },
        })
          .then((r) => r.json())
          .then((items: Array<{ id: string; typeId?: string | null }>) =>
            items.map((i) => ({ id: i.id, typeId: i.typeId ?? null })),
          )
      }
      onFetchSchema={(typeId) => api.types.schema(typeId)}
      onFetchObjects={(ids) =>
        Promise.all(ids.map((id) => api.items.getObject(id).catch(() => ({}))))
      }
      onCreateItem={(type) =>
        api.items.create({ value: `New ${type.value}`, type: type.value as ItemType, parentId: type.id })
      }
      queryKey={activeWorkingSetId ?? ''}
    />
  );
}
