import { ConfidenceBadge } from '../../shared/ConfidenceBadge';
import { TypeBadge } from '../../shared/TypeBadge';
import { TagChip } from '../../shared/TagChip';
import { useUiStore } from '../../../store/ui';
import type { KanectaItem } from '../../../types/kanecta';
import './GalleryCard.scss';

interface GalleryCardProps {
  item: KanectaItem;
}

export function GalleryCard({ item }: GalleryCardProps) {
  const { focusedItemId, setFocusedItem } = useUiStore();

  return (
    <div
      className={`GalleryCard${focusedItemId === item.id ? ' GalleryCard--focused' : ''}`}
      onClick={() => setFocusedItem(item.id)}
      aria-label={item.value}
    >
      <div className="GalleryCard-value">{item.value}</div>
      <div className="GalleryCard-meta">
        <TypeBadge type={item.type} />
        <ConfidenceBadge confidence={item.confidence} />
        {item.tags.slice(0, 2).map((t) => <TagChip key={t} tag={t} />)}
        {item.tags.length > 2 && (
          <span style={{ fontSize: '0.7rem', color: 'var(--color-text-muted)' }}>
            +{item.tags.length - 2}
          </span>
        )}
      </div>
    </div>
  );
}
