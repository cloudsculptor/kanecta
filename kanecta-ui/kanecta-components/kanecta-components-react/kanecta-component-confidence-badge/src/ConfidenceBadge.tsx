import './ConfidenceBadge.scss';

export type ConfidenceLevel = 'low' | 'medium' | 'high' | 'verified' | 'locked';

const LABELS: Record<ConfidenceLevel, string> = {
  low: 'Low',
  medium: 'Med',
  high: 'High',
  verified: 'Verified',
  locked: 'Locked',
};

export interface ConfidenceBadgeProps {
  confidence: ConfidenceLevel | null;
}

export function ConfidenceBadge({ confidence }: ConfidenceBadgeProps) {
  if (!confidence) return null;
  return (
    <span className={`ConfidenceBadge ConfidenceBadge--${confidence}`}>
      {LABELS[confidence]}
    </span>
  );
}
