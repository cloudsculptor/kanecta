import type { WorkspaceConfig } from '../../types/workspace';
import { useReviewStore } from '../../store/review';
import './BottomBar.scss';

interface BottomBarProps {
  workspace?: WorkspaceConfig;
  statusText?: string;
  onOpenReview?: () => void;
}

export function BottomBar({ workspace, statusText, onOpenReview }: BottomBarProps) {
  const { reviewQueue, unreviewedThreshold } = useReviewStore();
  const isPaused = reviewQueue.length >= unreviewedThreshold;

  return (
    <footer className="BottomBar">
      {workspace && (
        <div className="BottomBar-workspace">
          <span className="BottomBar-dot" style={{ color: workspace.colour }} />
          {workspace.name}
        </div>
      )}
      <div className="BottomBar-spacer" />
      {isPaused && (
        <button
          className="BottomBar-pause"
          onClick={onOpenReview}
          aria-label="Review backlog is large — click to review"
        >
          ⚠ {reviewQueue.length} unreviewed
        </button>
      )}
      {statusText && <span className="BottomBar-status">{statusText}</span>}
    </footer>
  );
}
