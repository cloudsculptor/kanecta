import { useQuery } from '@tanstack/react-query';
import {
  KanectaTable,
  type TablePayload,
  type TableColumnOverride,
} from '@kanecta/component-table';
import type { KanectaApi } from '../../api';

interface TableNodePreviewProps {
  itemId: string;
  api: KanectaApi;
}

/**
 * Host side of the tree-view `renderTable` seam: loads a `table` item's
 * payload (spec §tablePayload) and its `table-column` children, then mounts
 * the prop-driven grid with the saved-query execution path
 * (`POST /query/:id/run`) injected as `onRunQuery`.
 */
export function TableNodePreview({ itemId, api }: TableNodePreviewProps) {
  const { data: payload, error } = useQuery({
    queryKey: ['table-node-payload', itemId],
    queryFn: async () => (await api.items.getObject(itemId)) as unknown as TablePayload,
  });

  const { data: columns = [] } = useQuery({
    queryKey: ['table-node-columns', itemId],
    queryFn: async () => {
      // Children arrive in sortOrder — that order IS the column order.
      const kids = await api.items.children(itemId);
      const cols = kids.filter((k) => k.type === 'table-column');
      const payloads = await Promise.all(cols.map((c) => api.items.getObject(c.id)));
      return payloads as unknown as TableColumnOverride[];
    },
  });

  if (error) {
    return (
      <div style={{ color: 'var(--color-text-muted)', fontSize: '0.8125rem', padding: '4px 0' }}>
        Failed to load table configuration
      </div>
    );
  }
  if (!payload) return null;
  if (!payload.queryId) {
    return (
      <div style={{ color: 'var(--color-text-muted)', fontSize: '0.8125rem', padding: '4px 0' }}>
        Table has no query configured
      </div>
    );
  }

  return (
    <KanectaTable
      payload={payload}
      columns={columns}
      queryKey={itemId}
      onRunQuery={(queryId, params, rowLimit) =>
        api.query.run(queryId, params ?? undefined, rowLimit ?? undefined)
      }
    />
  );
}
