import './TagChip.scss';

interface TagChipProps {
  tag: string;
  onRemove?: () => void;
}

export function TagChip({ tag, onRemove }: TagChipProps) {
  return (
    <span className="TagChip">
      #{tag}
      {onRemove && (
        <button className="TagChip-remove" onClick={onRemove} aria-label={`Remove tag ${tag}`}>
          ×
        </button>
      )}
    </span>
  );
}
