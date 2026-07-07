import { useEffect, useCallback } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { ConfidenceBadge, type ConfidenceLevel } from '@kanecta/component-confidence-badge';
import { TypeBadge } from '@kanecta/component-type-badge';
import { TagChip } from '@kanecta/component-tag-chip';
import type { MissionReviewItem } from './types';
import './ReviewConveyor.scss';

interface ReviewConveyorProps {
  reviewQueue: MissionReviewItem[];
  conveyorIndex: number;
  onAdvanceConveyor: () => void;
  onMarkSeen: (ids: string[]) => void;
  onApproveItem: (id: string) => Promise<unknown>;
  onDeleteItem: (id: string) => Promise<unknown>;
  onClose: () => void;
  queryKeyPrefix?: string;
}

export function ReviewConveyor({
  reviewQueue,
  conveyorIndex,
  onAdvanceConveyor,
  onMarkSeen,
  onApproveItem,
  onDeleteItem,
  onClose,
  queryKeyPrefix = '',
}: ReviewConveyorProps) {
  const qc = useQueryClient();

  const current = reviewQueue[conveyorIndex];
  const remaining = reviewQueue.length - conveyorIndex;

  const approveMutation = useMutation({
    mutationFn: (id: string) => onApproveItem(id),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['mc-items', queryKeyPrefix] }); },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => onDeleteItem(id),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['mc-items', queryKeyPrefix] }); },
  });

  const handleApprove = useCallback(() => {
    if (!current) return;
    approveMutation.mutate(current.id);
    onMarkSeen([current.id]);
    onAdvanceConveyor();
  }, [current, approveMutation, onMarkSeen, onAdvanceConveyor]);

  const handleDelete = useCallback(() => {
    if (!current) return;
    deleteMutation.mutate(current.id);
    onMarkSeen([current.id]);
    onAdvanceConveyor();
  }, [current, deleteMutation, onMarkSeen, onAdvanceConveyor]);

  const handleSkip = useCallback(() => {
    if (!current) return;
    onAdvanceConveyor();
  }, [current, onAdvanceConveyor]);

  const handleNextNoAction = useCallback(() => {
    if (!current) return;
    onMarkSeen([current.id]);
    onAdvanceConveyor();
  }, [current, onMarkSeen, onAdvanceConveyor]);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      if (e.key === 'a' || e.key === 'A') handleApprove();
      if (e.key === 'd' || e.key === 'D') handleDelete();
      if (e.key === 'n' || e.key === 'N') handleNextNoAction();
      if (e.key === 'ArrowRight') handleSkip();
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [handleApprove, handleDelete, handleNextNoAction, handleSkip, onClose]);

  return (
    <div className="ReviewConveyor" role="main" aria-label="Review conveyor">
      <div className="ReviewConveyor__header">
        <span className="ReviewConveyor__progress">
          {conveyorIndex + 1} / {reviewQueue.length} — {remaining} remaining
        </span>
        <button className="ReviewConveyor__close" onClick={onClose} aria-label="Close review">×</button>
      </div>

      {!current ? (
        <div className="ReviewConveyor__done">
          <p>All items reviewed.</p>
          <button onClick={onClose}>Close</button>
        </div>
      ) : (
        <>
          <div className="ReviewConveyor__card">
            <div className="ReviewConveyor__card-badges">
              <TypeBadge type={current.type} />
              <ConfidenceBadge confidence={(current.confidence ?? null) as ConfidenceLevel | null} />
            </div>
            <p className="ReviewConveyor__card-value">{current.value}</p>
            {current.tags.length > 0 && (
              <div className="ReviewConveyor__card-tags">
                {current.tags.map((tag) => <TagChip key={tag} tag={tag} />)}
              </div>
            )}
            <p className="ReviewConveyor__card-meta">
              Created {new Date(current.createdAt ?? '').toLocaleDateString()}
            </p>
          </div>

          <div className="ReviewConveyor__actions">
            <button className="ReviewConveyor__action ReviewConveyor__action--approve" onClick={handleApprove} title="Approve — set confidence to high (A)">
              Approve <kbd>A</kbd>
            </button>
            <button className="ReviewConveyor__action ReviewConveyor__action--skip" onClick={handleSkip} title="Skip without action (→)">
              Skip <kbd>→</kbd>
            </button>
            <button className="ReviewConveyor__action ReviewConveyor__action--next" onClick={handleNextNoAction} title="Mark seen, no action (N)">
              Next <kbd>N</kbd>
            </button>
            <button className="ReviewConveyor__action ReviewConveyor__action--delete" onClick={handleDelete} title="Delete item (D)">
              Delete <kbd>D</kbd>
            </button>
          </div>
        </>
      )}
    </div>
  );
}
