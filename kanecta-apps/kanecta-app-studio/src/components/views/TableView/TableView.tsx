import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { FilterBar } from '../../shared/FilterBar';
import { SortBar } from '../../shared/SortBar';
import { ConfidenceBadge } from '../../shared/ConfidenceBadge';
import { TypeBadge } from '../../shared/TypeBadge';
import { TagChip } from '../../shared/TagChip';
import { useAllItems } from '../../../hooks/useAllItems';
import { useUiStore } from '../../../store/ui';
import { useWorkspaceStore } from '../../../store/workspace';
import type { KanectaItem } from '../../../types/kanecta';
import './TableView.scss';

interface TableViewProps {
  panelId: string;
}

function formatDate(iso: string) {
  try {
    return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
  } catch {
    return iso;
  }
}

export function TableView({ panelId }: TableViewProps) {
  const { items, isLoading, error, filter, sort } = useAllItems(panelId);
  const { setPanelFilter, setPanelSort, setFocusedItem, focusedItemId } = useUiStore();
  const { getApi } = useWorkspaceStore();
  const qc = useQueryClient();
  const [editCell, setEditCell] = useState<{ id: string; value: string } | null>(null);

  const allItems = items;

  const updateMutation = useMutation({
    mutationFn: ({ id, value }: { id: string; value: string }) =>
      getApi().items.update(id, { value }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['all-items'] }),
  });

  const commitEdit = (item: KanectaItem) => {
    if (!editCell) return;
    if (editCell.value !== item.value && editCell.value.trim()) {
      updateMutation.mutate({ id: item.id, value: editCell.value.trim() });
    }
    setEditCell(null);
  };

  if (isLoading) return <div className="TableView"><div className="TableView-empty">Loading…</div></div>;
  if (error) return <div className="TableView"><div className="TableView-empty">Error loading items</div></div>;

  return (
    <div className="TableView" data-testid={`table-view-${panelId}`}>
      <div className="TableView-controls">
        <FilterBar
          filter={filter}
          onChange={(f) => setPanelFilter(panelId, f)}
          totalCount={allItems.length}
          filteredCount={items.length}
        />
        <SortBar sort={sort} onChange={(s) => setPanelSort(panelId, s)} />
      </div>

      <div className="TableView-scroll">
        {items.length === 0 ? (
          <div className="TableView-empty">No items match the current filter</div>
        ) : (
          <table className="TableView-table">
            <thead className="TableView-thead">
              <tr>
                <th>Value</th>
                <th>Type</th>
                <th>Confidence</th>
                <th>Tags</th>
                <th>Created</th>
                <th>Modified</th>
              </tr>
            </thead>
            <tbody>
              {items.map((item) => (
                <tr
                  key={item.id}
                  className={`TableView-row${focusedItemId === item.id ? ' TableView-row--focused' : ''}`}
                  onClick={() => setFocusedItem(item.id)}
                >
                  <td>
                    {editCell?.id === item.id ? (
                      <div className="TableView-cell-editing">
                        <input
                          autoFocus
                          value={editCell.value}
                          onChange={(e) => setEditCell({ id: item.id, value: e.target.value })}
                          onBlur={() => commitEdit(item)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') commitEdit(item);
                            if (e.key === 'Escape') setEditCell(null);
                          }}
                          onClick={(e) => e.stopPropagation()}
                          aria-label={`Edit value for ${item.value}`}
                        />
                      </div>
                    ) : (
                      <span
                        className="TableView-cell-value"
                        title={item.value}
                        onDoubleClick={(e) => {
                          e.stopPropagation();
                          setEditCell({ id: item.id, value: item.value });
                        }}
                      >
                        {item.value}
                      </span>
                    )}
                  </td>
                  <td><TypeBadge type={item.type} /></td>
                  <td><ConfidenceBadge confidence={item.confidence} /></td>
                  <td>
                    <div className="TableView-tags">
                      {item.tags.map((t) => <TagChip key={t} tag={t} />)}
                    </div>
                  </td>
                  <td>{formatDate(item.createdAt)}</td>
                  <td>{formatDate(item.modifiedAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
