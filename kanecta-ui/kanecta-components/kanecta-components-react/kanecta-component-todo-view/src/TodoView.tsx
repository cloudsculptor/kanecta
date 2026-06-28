import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Checkbox } from '@mui/material';
import { useDataSource } from '@kanecta/component-core';
import type { KanectaItem } from '@kanecta/component-core';
import './TodoView.css';

export interface TodoViewProps {
  itemId: string | null;
}

export function TodoView({ itemId }: TodoViewProps) {
  const ds = useDataSource();
  const qc = useQueryClient();

  const { data: parent, isLoading: parentLoading } = useQuery({
    queryKey: ['todo-parent', itemId],
    queryFn: () => ds.get(itemId!),
    enabled: !!itemId,
  });

  const { data: children = [], isLoading: childrenLoading } = useQuery({
    queryKey: ['todo-children', itemId],
    queryFn: () => ds.query({ parentId: itemId! }),
    enabled: !!itemId,
  });

  const handleToggle = async (item: KanectaItem) => {
    await ds.update(item.id, {
      completedAt: item.completedAt ? null : new Date().toISOString(),
    });
    await qc.invalidateQueries({ queryKey: ['todo-children', itemId] });
  };

  if (!itemId) {
    return (
      <div className="TodoView">
        <p className="TodoView-empty">No item selected. Enter a UUID or alias in the top bar.</p>
      </div>
    );
  }

  if (parentLoading || childrenLoading) {
    return <div className="TodoView"><p className="TodoView-empty">Loading…</p></div>;
  }

  return (
    <div className="TodoView">
      {parent && <h2 className="TodoView-heading">{parent.value}</h2>}
      {children.length === 0 && (
        <p className="TodoView-empty">No children.</p>
      )}
      <ul className="TodoView-list">
        {children.map(child => (
          <li key={child.id} className={`TodoView-item${child.completedAt ? ' TodoView-item--done' : ''}`}>
            <Checkbox
              checked={!!child.completedAt}
              onChange={() => void handleToggle(child)}
              size="small"
              sx={{ p: '2px' }}
            />
            <span className="TodoView-item-label">{child.value}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
