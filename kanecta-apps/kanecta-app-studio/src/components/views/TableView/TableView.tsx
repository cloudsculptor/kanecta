import { useState, useMemo } from 'react';
import type { ItemType } from '../../../types/kanecta';
import type { ViewMeta } from '../../../lib/viewMeta';
import { useViewLocation } from '../../../context/LocationContext';

export const TableViewMeta: ViewMeta = {
  uuid: 'c4b3d2e1-f5a6-4b7c-8d9e-0f1a2b3c4d5e',
  name: 'table',
  label: 'Table',
  icon: 'TableChart',
};
import { AgGridReact } from 'ag-grid-react';
import { AllCommunityModule, themeQuartz, type ColDef } from 'ag-grid-community';
import { useQuery } from '@tanstack/react-query';
import { useWorkspaceStore } from '../../../store/workspace';
import { useAllItems } from '../../../hooks/useAllItems';
import { TypeList } from '../../shared/TypeList';
import type { TypeDefinition } from '../../../api/types';
import type { ItemType } from '../../../types/kanecta';
import './TableView.scss';

const theme = themeQuartz;

function schemaToColDefs(schema: unknown): ColDef[] {
  try {
    const s = schema as {
      meta?: { primaryField?: string };
      jsonSchema?: { properties?: Record<string, { title?: string }> };
    };
    const props = s?.jsonSchema?.properties;
    if (!props) return [];
    const primaryField = s?.meta?.primaryField ?? '';
    const cols = Object.entries(props).map(([key, def]) => ({
      field: key,
      headerName: def.title ?? key,
      width: 250,
      sortable: true,
      filter: true,
    }));
    if (primaryField) {
      const idx = cols.findIndex((c) => c.field === primaryField);
      if (idx >= 0) {
        cols[idx] = { ...cols[idx], width: 750 };
        if (idx > 0) cols.unshift(cols.splice(idx, 1)[0]);
      }
    }
    return cols;
  } catch {
    return [];
  }
}

export function TableView() {
  useViewLocation(TableViewMeta.uuid);
  const [selectedType, setSelectedType] = useState<TypeDefinition | null>(null);
  const { getApi } = useWorkspaceStore();
  const { items } = useAllItems('table-view');

  const typeItems = useMemo(
    () => (selectedType ? items.filter((item) => item.typeId === selectedType.id) : []),
    [items, selectedType],
  );

  const { data: schema } = useQuery({
    queryKey: ['type-schema', selectedType?.id],
    queryFn: () => getApi().types.schema(selectedType!.id),
    enabled: !!selectedType,
  });

  const columnDefs = useMemo(() => schemaToColDefs(schema), [schema]);

  const { data: rowData = [] } = useQuery({
    queryKey: ['type-objects', selectedType?.id, typeItems.length],
    queryFn: async () => {
      const objects = await Promise.all(
        typeItems.map((item) => getApi().items.getObject(item.id).catch(() => ({}))),
      );
      return objects;
    },
    enabled: !!selectedType && typeItems.length > 0,
  });

  return (
    <div className="TableView">
      <div className="TableView-sidebar">
        <TypeList
          selectedTypeId={selectedType?.id ?? null}
          onSelect={setSelectedType}
          onCreateItem={(t) => void getApi().items.create({ value: `New ${t.value}`, type: t.value as ItemType })}
        />
      </div>
      <div className="TableView-grid">
        {!selectedType && (
          <div className="TableView-empty">Select a type to view its items</div>
        )}
        {selectedType && !!schema && columnDefs.length === 0 && (
          <div className="TableView-empty">No schema fields defined for this type</div>
        )}
        {selectedType && columnDefs.length > 0 && typeItems.length === 0 && (
          <div className="TableView-empty">No items of this type</div>
        )}
        {selectedType && columnDefs.length > 0 && typeItems.length > 0 && (
          <AgGridReact
            modules={[AllCommunityModule]}
            theme={theme}
            rowData={rowData}
            columnDefs={columnDefs}
            defaultColDef={{ resizable: true, minWidth: 200 }}
          />
        )}
      </div>
    </div>
  );
}
