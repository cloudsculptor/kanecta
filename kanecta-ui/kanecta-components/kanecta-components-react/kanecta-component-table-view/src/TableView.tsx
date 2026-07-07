import { useState } from 'react';
import { AgGridReact } from 'ag-grid-react';
import { AllCommunityModule, themeQuartz, type ColDef } from 'ag-grid-community';
import { useQuery } from '@tanstack/react-query';
import { TypeList, type TypeItem } from '@kanecta/component-type-list';
import './TableView.scss';

const theme = themeQuartz;

// ── Public types ─────────────────────────────────────────────────────────────

export interface TableItem {
  id: string;
  typeId?: string | null;
}

export interface TableStats {
  structured: Array<{ typeId: string; count: number }>;
}

export interface TableViewProps {
  onFetchTypes: () => Promise<TypeItem[]>;
  onFetchStats: () => Promise<TableStats>;
  onFetchItemsByType: (typeId: string) => Promise<TableItem[]>;
  onFetchSchema: (typeId: string) => Promise<unknown>;
  onFetchObjects: (itemIds: string[]) => Promise<unknown[]>;
  onCreateItem: (type: TypeItem) => Promise<unknown>;
  queryKey?: string;
}

// ── Schema → column defs ─────────────────────────────────────────────────────

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

// ── Component ────────────────────────────────────────────────────────────────

export function TableView({
  onFetchTypes,
  onFetchStats,
  onFetchItemsByType,
  onFetchSchema,
  onFetchObjects,
  onCreateItem,
  queryKey = '',
}: TableViewProps) {
  const [selectedType, setSelectedType] = useState<TypeItem | null>(null);

  const { data: types = [], isLoading: typesLoading } = useQuery({
    queryKey: ['table-types', queryKey],
    queryFn: onFetchTypes,
  });

  const { data: stats } = useQuery({
    queryKey: ['table-stats', queryKey],
    queryFn: onFetchStats,
  });

  const countByTypeId = new Map<string, number>(
    (stats?.structured ?? []).map(({ typeId, count }) => [typeId, count]),
  );

  const { data: schema } = useQuery({
    queryKey: ['table-schema', queryKey, selectedType?.id],
    queryFn: () => onFetchSchema(selectedType!.id),
    enabled: !!selectedType,
  });

  const columnDefs = schemaToColDefs(schema);

  const { data: typeItems = [] } = useQuery({
    queryKey: ['table-items-by-type', queryKey, selectedType?.id],
    queryFn: () => onFetchItemsByType(selectedType!.id),
    enabled: !!selectedType,
  });

  const { data: rowData = [] } = useQuery({
    queryKey: ['table-objects', queryKey, selectedType?.id, typeItems.length],
    queryFn: () => onFetchObjects(typeItems.map((i) => i.id)),
    enabled: !!selectedType && typeItems.length > 0,
  });

  return (
    <div className="TableView">
      <div className="TableView__sidebar">
        <TypeList
          types={types}
          countByTypeId={countByTypeId}
          isLoading={typesLoading}
          selectedTypeId={selectedType?.id ?? null}
          onSelect={setSelectedType}
          onCreateItem={(t) => void onCreateItem(t)}
        />
      </div>
      <div className="TableView__grid">
        {!selectedType && (
          <div className="TableView__empty">Select a type to view its items</div>
        )}
        {selectedType && !!schema && columnDefs.length === 0 && (
          <div className="TableView__empty">No schema fields defined for this type</div>
        )}
        {selectedType && columnDefs.length > 0 && typeItems.length === 0 && (
          <div className="TableView__empty">No items of this type</div>
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
