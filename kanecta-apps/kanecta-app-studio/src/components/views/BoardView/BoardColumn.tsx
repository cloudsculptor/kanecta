import { useDroppable } from '@dnd-kit/core';
import { SortableContext, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { BoardCard } from './BoardCard';
import type { KanectaItem } from '../../../types/kanecta';
import './BoardColumn.scss';

interface BoardColumnProps {
  id: string;
  title: string;
  items: KanectaItem[];
  colour?: string;
}

export function BoardColumn({ id, title, items, colour }: BoardColumnProps) {
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
            <BoardCard key={item.id} item={item} />
          ))}
        </SortableContext>
      </div>
    </div>
  );
}
