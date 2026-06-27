import { useState } from 'react';
import type { ViewMeta } from '../../../lib/viewMeta';
import { useViewLocation } from '../../../context/LocationContext';

export const BoardViewMeta: ViewMeta = {
  uuid: 'e6d5f4a3-b7c8-4d9e-0f1a-2b3c4d5e6f7a',
  name: 'board',
  label: 'Board',
  icon: 'ViewKanban',
};
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core';
import { sortableKeyboardCoordinates } from '@dnd-kit/sortable';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { BoardColumn } from './BoardColumn';
import { FilterBar } from '@kanecta/component-filter-bar';
import { ITEM_TYPES, CONFIDENCE_LEVELS } from '../../../lib/constants';
import { useAllItems } from '../../../hooks/useAllItems';
import { useUiStore } from '../../../store/ui';
import { useWorkspaceStore } from '../../../store/workspace';
import { groupBy } from '../../../lib/items';
import type { KanectaItem, Confidence } from '../../../types/kanecta';
import './BoardView.scss';

type GroupByField = 'confidence' | 'type';

const CONFIDENCE_COLUMNS: Confidence[] = ['low', 'medium', 'high', 'verified', 'locked'];
const CONFIDENCE_COLOURS: Record<Confidence, string> = {
  low: '#c62828', medium: '#e65100', high: '#2e7d32', verified: '#1565c0', locked: '#6a1b9a',
};

interface BoardViewProps {
  panelId: string;
}

export function BoardView({ panelId }: BoardViewProps) {
  useViewLocation(BoardViewMeta.uuid);
  const { items, isLoading, filter } = useAllItems(panelId);
  const { setPanelFilter } = useUiStore();
  const { getApi } = useWorkspaceStore();
  const qc = useQueryClient();
  const [groupField, setGroupField] = useState<GroupByField>('confidence');

  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const updateMutation = useMutation({
    mutationFn: ({ id, changes }: { id: string; changes: Partial<KanectaItem> }) =>
      getApi().items.update(id, changes),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['all-items'] }),
  });

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;

    const item = items.find((i) => i.id === active.id);
    if (!item) return;

    if (groupField === 'confidence') {
      const newConfidence = over.id as Confidence;
      if (CONFIDENCE_COLUMNS.includes(newConfidence) && newConfidence !== item.confidence) {
        updateMutation.mutate({ id: item.id, changes: { confidence: newConfidence } });
      }
    }
  };

  if (isLoading) return <div className="BoardView"><div className="BoardView-empty">Loading…</div></div>;

  const groupedByConfidence = groupBy(items, (i) => i.confidence ?? 'none');
  const groupedByType = groupBy(items, (i) => i.type);

  const columns = groupField === 'confidence'
    ? CONFIDENCE_COLUMNS.map((c) => ({
        id: c,
        title: c,
        items: groupedByConfidence.get(c) ?? [],
        colour: CONFIDENCE_COLOURS[c],
      }))
    : Array.from(groupedByType.entries()).map(([type, typeItems]) => ({
        id: type,
        title: type,
        items: typeItems,
        colour: undefined,
      }));

  return (
    <div className="BoardView" data-testid={`board-view-${panelId}`}>
      <div className="BoardView-controls">
        <FilterBar
          filter={filter}
          onChange={(f) => setPanelFilter(panelId, f)}
          totalCount={items.length}
          filteredCount={items.length}
          itemTypes={ITEM_TYPES}
          confidenceLevels={CONFIDENCE_LEVELS}
        />
        <div className="BoardView-group-select">
          <span>Group by</span>
          <select value={groupField} onChange={(e) => setGroupField(e.target.value as GroupByField)}>
            <option value="confidence">Confidence</option>
            <option value="type">Type</option>
          </select>
        </div>
      </div>

      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
        <div className="BoardView-columns">
          {columns.map((col) => (
            <BoardColumn
              key={col.id}
              id={col.id}
              title={col.title}
              items={col.items}
              colour={col.colour}
            />
          ))}
        </div>
      </DndContext>
    </div>
  );
}
