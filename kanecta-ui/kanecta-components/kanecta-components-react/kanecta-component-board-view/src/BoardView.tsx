import { useState } from 'react';
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core';
import {
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import type { FilterState } from '@kanecta/component-core';
import { FilterBar } from '@kanecta/component-filter-bar';
import { TypeBadge } from '@kanecta/component-type-badge';
import { TagChip } from '@kanecta/component-tag-chip';
import './BoardView.css';

export interface BoardItem {
  id: string;
  value: string;
  type: string;
  confidence: string | null;
  tags: string[];
}

type GroupByField = 'confidence' | 'type';

const CONFIDENCE_COLUMNS = ['low', 'medium', 'high', 'verified', 'locked'];
const CONFIDENCE_COLOURS: Record<string, string> = {
  low: '#c62828', medium: '#e65100', high: '#2e7d32', verified: '#1565c0', locked: '#6a1b9a',
};

function groupBy<T>(items: T[], key: (item: T) => string): Map<string, T[]> {
  const map = new Map<string, T[]>();
  for (const item of items) {
    const k = key(item);
    if (!map.has(k)) map.set(k, []);
    map.get(k)!.push(item);
  }
  return map;
}

interface BoardCardProps {
  item: BoardItem;
  isSelected: boolean;
  onSelect: (id: string) => void;
}

function BoardCard({ item, isSelected, onSelect }: BoardCardProps) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id: item.id, resizeObserverConfig: undefined });

  const style = { transform: CSS.Transform.toString(transform), transition };

  return (
    <div
      ref={setNodeRef}
      style={style}
      {...attributes}
      {...listeners}
      className={[
        'BoardCard',
        isDragging ? 'BoardCard--dragging' : '',
        isSelected ? 'BoardCard--focused' : '',
      ].filter(Boolean).join(' ')}
      onClick={() => onSelect(item.id)}
      aria-label={item.value}
    >
      <div className="BoardCard-value">{item.value}</div>
      <div className="BoardCard-footer">
        <TypeBadge type={item.type} />
        {item.tags.map((t) => <TagChip key={t} tag={t} />)}
      </div>
    </div>
  );
}

interface BoardColumnProps {
  id: string;
  title: string;
  items: BoardItem[];
  colour?: string;
  selectedId?: string | null;
  onSelect: (id: string) => void;
}

function BoardColumn({ id, title, items, colour, selectedId, onSelect }: BoardColumnProps) {
  const { setNodeRef, isOver } = useDroppable({ id });

  return (
    <div className={`BoardColumn${isOver ? ' BoardColumn--over' : ''}`}>
      <div className="BoardColumn-header">
        <span className="BoardColumn-title" style={colour ? { color: colour } : undefined}>
          {title}
        </span>
        <span className="BoardColumn-count">{items.length}</span>
      </div>
      <div ref={setNodeRef} className="BoardColumn-cards">
        <SortableContext items={items.map((i) => i.id)} strategy={verticalListSortingStrategy}>
          {items.map((item) => (
            <BoardCard
              key={item.id}
              item={item}
              isSelected={selectedId === item.id}
              onSelect={onSelect}
            />
          ))}
        </SortableContext>
      </div>
    </div>
  );
}

export interface BoardViewProps {
  items: BoardItem[];
  isLoading?: boolean;
  filter: FilterState;
  onFilterChange: (filter: FilterState) => void;
  onMoveToGroup: (id: string, field: 'confidence' | 'type', value: string) => void;
  selectedId?: string | null;
  onSelect?: (id: string) => void;
  itemTypes?: string[];
  confidenceLevels?: string[];
  panelId?: string;
}

export function BoardView({
  items,
  isLoading,
  filter,
  onFilterChange,
  onMoveToGroup,
  selectedId,
  onSelect,
  itemTypes = [],
  confidenceLevels = [],
  panelId,
}: BoardViewProps) {
  const [groupField, setGroupField] = useState<GroupByField>('confidence');

  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const item = items.find((i) => i.id === active.id);
    if (!item) return;
    if (groupField === 'confidence') {
      const newVal = String(over.id);
      if (CONFIDENCE_COLUMNS.includes(newVal) && newVal !== item.confidence) {
        onMoveToGroup(item.id, 'confidence', newVal);
      }
    }
  };

  if (isLoading) {
    return (
      <div className="BoardView">
        <div className="BoardView-empty">Loading…</div>
      </div>
    );
  }

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
    <div className="BoardView" data-testid={panelId ? `board-view-${panelId}` : undefined}>
      <div className="BoardView-controls">
        <FilterBar
          filter={filter}
          onChange={onFilterChange}
          totalCount={items.length}
          filteredCount={items.length}
          itemTypes={itemTypes}
          confidenceLevels={confidenceLevels}
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
              selectedId={selectedId}
              onSelect={(id) => onSelect?.(id)}
            />
          ))}
        </div>
      </DndContext>
    </div>
  );
}
