import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Checkbox } from '@mui/material';
import { useWorkspaceStore } from '../../../store/workspace';
import { useLocation } from '../../../context/LocationContext';
import type { KanectaItem } from '../../../types/kanecta';
import './TodoView.scss';

export function TodoView() {
  const { itemId } = useLocation();
  const { getApi } = useWorkspaceStore();
  const api = getApi();
  const qc = useQueryClient();

  const { data: parent, isLoading: parentLoading } = useQuery({
    queryKey: ['todo-parent', itemId],
    queryFn: () => api.items.get(itemId!),
    enabled: !!itemId,
  });

  const { data: children = [], isLoading: childrenLoading } = useQuery({
    queryKey: ['todo-children', itemId],
    queryFn: () => api.items.children(itemId!),
    enabled: !!itemId,
  });

  const handleToggle = async (item: KanectaItem) => {
    if (item.completedAt) {
      await api.items.uncomplete(item.id);
    } else {
      await api.items.complete(item.id);
    }
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
