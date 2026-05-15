import type { ItemType } from '../../types/kanecta';
import './TypeBadge.scss';

interface TypeBadgeProps {
  type: ItemType;
}

export function TypeBadge({ type }: TypeBadgeProps) {
  return <span className="TypeBadge">{type}</span>;
}
