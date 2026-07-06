import './TypeBadge.scss';

export interface TypeBadgeProps {
  type: string;
}

export function TypeBadge({ type }: TypeBadgeProps) {
  return <span className="TypeBadge">{type}</span>;
}
