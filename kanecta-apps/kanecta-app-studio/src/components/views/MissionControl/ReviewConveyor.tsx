import { useEffect, useCallback } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useReviewStore } from '../../../store/review';
import { useWorkspaceStore } from '../../../store/workspace';
import { ConfidenceBadge } from '../../shared/ConfidenceBadge';
import { TypeBadge } from '../../shared/TypeBadge';
import { TagChip } from '../../shared/TagChip';
import './ReviewConveyor.scss';

interface ReviewConveyorProps {
  onClose: () => void;
}

export function ReviewConveyor({ onClose }: ReviewConveyorProps) {
  const { reviewQueue, conveyorIndex, advanceConveyor, markSeen } = useReviewStore();
  const { getApi } = useWorkspaceStore();
  const qc = useQueryClient();

  const current = reviewQueue[conveyorIndex];
  const remaining = reviewQueue.length - conveyorIndex;

  const approveMutation = useMutation({
    mutationFn: (id: string) =>
      getApi().items.update(id, { confidence: 'high' }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['items-list'] });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => getApi().items.delete(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['items-list'] });
    },
  });

  const handleApprove = useCallback(() => {
    if (!current) return;
    approveMutation.mutate(current.id);
    markSeen([current.id]);
    advanceConveyor();
  }, [current, approveMutation, markSeen, advanceConveyor]);

  const handleDelete = useCallback(() => {
    if (!current) return;
    deleteMutation.mutate(current.id);
    markSeen([current.id]);
    advanceConveyor();
  }, [current, deleteMutation, markSeen, advanceConveyor]);

  const handleSkip = useCallback(() => {
    if (!current) return;
    advanceConveyor();
  }, [current, advanceConveyor]);

  const handleNextNoAction = useCallback(() => {
    if (!current) return;
    markSeen([current.id]);
    advanceConveyor();
  }, [current, markSeen, advanceConveyor]);

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
      <div className="ReviewConveyor-header">
        <span className="ReviewConveyor-progress">
          {conveyorIndex + 1} / {reviewQueue.length} — {remaining} remaining
        </span>
        <button className="ReviewConveyor-close" onClick={onClose} aria-label="Close review">
          ×
        </button>
      </div>

      {!current ? (
        <div className="ReviewConveyor-done">
          <p>All items reviewed.</p>
          <button onClick={onClose}>Close</button>
        </div>
      ) : (
        <>
          <div className="ReviewConveyor-card">
            <div className="ReviewConveyor-card-badges">
              <TypeBadge type={current.type} />
              <ConfidenceBadge confidence={current.confidence} />
            </div>
            <p className="ReviewConveyor-card-value">{current.value}</p>
            {current.tags.length > 0 && (
              <div className="ReviewConveyor-card-tags">
                {current.tags.map((tag) => <TagChip key={tag} tag={tag} />)}
              </div>
            )}
            <p className="ReviewConveyor-card-meta">
              Created {new Date(current.createdAt ?? '').toLocaleDateString()}
            </p>
          </div>

          <div className="ReviewConveyor-actions">
            <button
              className="ReviewConveyor-action ReviewConveyor-action--approve"
              onClick={handleApprove}
              title="Approve — set confidence to high (A)"
            >
              Approve <kbd>A</kbd>
            </button>
            <button
              className="ReviewConveyor-action ReviewConveyor-action--skip"
              onClick={handleSkip}
              title="Skip without action (→)"
            >
              Skip <kbd>→</kbd>
            </button>
            <button
              className="ReviewConveyor-action ReviewConveyor-action--next"
              onClick={handleNextNoAction}
              title="Mark seen, no action (N)"
            >
              Next <kbd>N</kbd>
            </button>
            <button
              className="ReviewConveyor-action ReviewConveyor-action--delete"
              onClick={handleDelete}
              title="Delete item (D)"
            >
              Delete <kbd>D</kbd>
            </button>
          </div>
        </>
      )}
    </div>
  );
}
