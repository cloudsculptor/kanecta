import { useMemo } from 'react';
import { AgGridReact } from 'ag-grid-react';
import {
  AllCommunityModule,
  themeQuartz,
  type ColDef,
  type GridReadyEvent,
} from 'ag-grid-community';
import { useQuery } from '@tanstack/react-query';
import './KanectaTable.scss';

const theme = themeQuartz;

// ── Public types ─────────────────────────────────────────────────────────────

/** A `table` item's payload (spec §tablePayload). */
export interface TablePayload {
  queryId: string;
  queryParams?: Record<string, unknown> | null;
  defaultSortField?: string | null;
  defaultSortDirection?: 'asc' | 'desc' | null;
  defaultFilters?: Record<string, unknown> | null;
  pageSize?: number | null;
  rowLimit?: number | null;
  description?: string | null;
}

/** A `table-column` child's payload (spec §tableColumnPayload), in sortOrder. */
export interface TableColumnOverride {
  field: string;
  label?: string | null;
  width?: number | null;
  hidden?: boolean | null;
}

/** Shape returned by the saved-query execution path (lib `runSavedQuery`). */
export interface SavedQueryRun {
  columns: Array<{ name: string; dataType?: string | null }>;
  rows: Array<Record<string, unknown>>;
  rowCount: number;
  truncated: boolean;
  description?: string | null;
  returnType?: string | null;
}

export type RunQuery = (
  queryId: string,
  params: Record<string, unknown> | null | undefined,
  rowLimit: number | null | undefined,
) => Promise<SavedQueryRun>;

export interface KanectaTableProps {
  payload: TablePayload;
  /** Ordered `table-column` child payloads (sortOrder = display order). */
  columns?: TableColumnOverride[];
  /** Host seam: execute the referenced saved query (API/MCP/lib — component doesn't care). */
  onRunQuery: RunQuery;
  queryKey?: string;
}

// ── Result columns + overrides → column defs ─────────────────────────────────

/**
 * Overridden columns lead in their declared order; result-set columns without
 * an override follow in result order; `hidden: true` overrides drop out.
 */
export function buildColDefs(
  resultColumns: Array<{ name: string }>,
  overrides: TableColumnOverride[],
  sortField?: string | null,
  sortDirection?: 'asc' | 'desc' | null,
): ColDef[] {
  const byField = new Map(overrides.map((o) => [o.field, o]));
  const ordered = [
    ...overrides.map((o) => o.field).filter((f) => resultColumns.some((c) => c.name === f)),
    ...resultColumns.map((c) => c.name).filter((n) => !byField.has(n)),
  ];
  return ordered
    .filter((field) => !byField.get(field)?.hidden)
    .map((field) => {
      const o = byField.get(field);
      const def: ColDef = {
        field,
        headerName: o?.label ?? field,
        sortable: true,
        filter: true,
      };
      if (o?.width) def.width = o.width;
      if (sortField === field && sortDirection) def.sort = sortDirection;
      return def;
    });
}

// ── Component ────────────────────────────────────────────────────────────────

export function KanectaTable({ payload, columns = [], onRunQuery, queryKey = '' }: KanectaTableProps) {
  const { data, isLoading, error } = useQuery({
    queryKey: ['kanecta-table', queryKey, payload.queryId, payload.queryParams, payload.rowLimit],
    queryFn: () => onRunQuery(payload.queryId, payload.queryParams, payload.rowLimit),
  });

  const columnDefs = useMemo(
    () =>
      data
        ? buildColDefs(data.columns, columns, payload.defaultSortField, payload.defaultSortDirection)
        : [],
    [data, columns, payload.defaultSortField, payload.defaultSortDirection],
  );

  const onGridReady = (event: GridReadyEvent) => {
    if (payload.defaultFilters) {
      // ag-grid filter model, stored opaquely on the payload (x-kanecta-storage: json).
      event.api.setFilterModel(payload.defaultFilters);
    }
  };

  if (isLoading) return <div className="KanectaTable__empty">Loading table…</div>;
  if (error) {
    return (
      <div className="KanectaTable__error">
        Query failed: {error instanceof Error ? error.message : String(error)}
      </div>
    );
  }
  if (!data) return null;
  if (data.rows.length === 0) return <div className="KanectaTable__empty">No rows</div>;

  return (
    <div className="KanectaTable">
      {payload.description && <div className="KanectaTable__description">{payload.description}</div>}
      <div className="KanectaTable__grid">
        <AgGridReact
          modules={[AllCommunityModule]}
          theme={theme}
          rowData={data.rows}
          columnDefs={columnDefs}
          defaultColDef={{ resizable: true, minWidth: 100 }}
          pagination={!!payload.pageSize}
          paginationPageSize={payload.pageSize ?? undefined}
          onGridReady={onGridReady}
        />
      </div>
      {data.truncated && (
        <div className="KanectaTable__truncated">
          Showing first {data.rows.length} rows — result truncated at the row limit.
        </div>
      )}
    </div>
  );
}
