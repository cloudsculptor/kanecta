import type { Confidence } from '../../types/kanecta';
import './ConfidenceBadge.scss';

const LABELS: Record<Confidence, string> = {
  low: 'Low',
  medium: 'Med',
  high: 'High',
  verified: 'Verified',
  locked: 'Locked',
};

interface ConfidenceBadgeProps {
  confidence: Confidence | null;
}

export function ConfidenceBadge({ confidence }: ConfidenceBadgeProps) {
  if (!confidence) return null;
  return (
    <span className={`ConfidenceBadge ConfidenceBadge--${confidence}`}>
      {LABELS[confidence]}
    </span>
  );
}
