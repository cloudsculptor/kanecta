import type { ViewMeta } from '../../../lib/viewMeta';
import { useViewLocation } from '../../../context/LocationContext';
import { TypesView as TypesViewPkg } from '@kanecta/component-types-view';
import { useWorkspaceStore } from '../../../store/workspace';
import type { ItemType } from '../../../types/kanecta';
import typeSpecRaw from '../../../../../../kanecta-specification/1.2.0/file-specs/type.json?raw';

export const TypesViewMeta: ViewMeta = {
  uuid: 'd5c4e3f2-a6b7-4c8d-9e0f-1a2b3c4d5e6f',
  name: 'types',
  label: 'Types',
  icon: 'DashboardCustomize',
};

export function TypesView() {
  useViewLocation(TypesViewMeta.uuid);
  const { getApi, activeWorkspaceId } = useWorkspaceStore();
  const api = getApi();

  return (
    <TypesViewPkg
      onFetchTypes={() => api.types.list()}
      onFetchStats={() => api.items.stats()}
      onFetchSchema={(typeId) => api.types.schema(typeId)}
      onSaveSchema={(typeId, schema) => api.types.saveSchema(typeId, schema)}
      onFetchMetadata={(typeId) => api.types.metadata(typeId)}
      onCreateType={(name) => api.types.create(name)}
      onCreateItem={(type) => api.items.create({ value: `New ${type.value}`, type: type.value as ItemType })}
      onFetchSystemTypes={() => api.systemItems.list()}
      onImportTypes={(ids) => api.systemItems.importItems(ids)}
      onExportTypes={(ids) => api.systemItems.exportItems(ids)}
      typeSpec={typeSpecRaw}
      queryKey={activeWorkspaceId ?? ''}
    />
  );
}
