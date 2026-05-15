import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { TypeBadge } from '../../shared/TypeBadge';
import { TagChip } from '../../shared/TagChip';
import { useUiStore } from '../../../store/ui';
import type { KanectaItem } from '../../../types/kanecta';
import './BoardCard.scss';

interface BoardCardProps {
  item: KanectaItem;
}

export function BoardCard({ item }: BoardCardProps) {
  const { focusedItemId, setFocusedItem } = useUiStore();
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id: item.id });

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
        focusedItemId === item.id ? 'BoardCard--focused' : '',
      ].filter(Boolean).join(' ')}
      onClick={() => setFocusedItem(item.id)}
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
