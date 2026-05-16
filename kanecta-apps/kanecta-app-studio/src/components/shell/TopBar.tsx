import { IconButton, Tooltip } from '@mui/material';
import SearchIcon from '@mui/icons-material/Search';
import AddIcon from '@mui/icons-material/Add';
import SettingsIcon from '@mui/icons-material/Settings';
import { useReviewStore } from '../../store/review';
import './TopBar.scss';

interface TopBarProps {
  onQuickCapture?: () => void;
  onCommandPalette?: () => void;
  onOpenSettings?: () => void;
  onOpenReview?: () => void;
}

export function TopBar({ onQuickCapture, onCommandPalette, onOpenSettings, onOpenReview }: TopBarProps) {
  const { reviewQueue } = useReviewStore();
  const unreviewedCount = reviewQueue.length;

  return (
    <header className="TopBar">
      <img src="/logo.svg" alt="Kanecta" className="TopBar-logo-img" />
      <span className="TopBar-logo">Kanecta</span>
      <div className="TopBar-spacer" />
      <div
        className="TopBar-search"
        onClick={onCommandPalette}
        onKeyDown={(e) => e.key === 'Enter' && onCommandPalette?.()}
        role="button"
        tabIndex={0}
        aria-label="Search (Ctrl+K)"
      >
        <SearchIcon className="TopBar-search-icon" />
        <span className="TopBar-search-placeholder">Search…</span>
        <span className="TopBar-search-shortcut">Ctrl+K</span>
      </div>
      <Tooltip title="Command palette (Ctrl+K)">
        <IconButton size="small" onClick={onCommandPalette} aria-label="Command palette" className="TopBar-search-btn">
          <SearchIcon fontSize="small" />
        </IconButton>
      </Tooltip>
      <Tooltip title="Quick capture (Ctrl+Space)">
        <IconButton size="small" onClick={onQuickCapture} aria-label="Quick capture">
          <AddIcon fontSize="small" />
        </IconButton>
      </Tooltip>
      <Tooltip title="Settings">
        <IconButton size="small" onClick={onOpenSettings} aria-label="Settings">
          <SettingsIcon fontSize="small" />
        </IconButton>
      </Tooltip>
      {unreviewedCount > 0 && (
        <Tooltip title={`${unreviewedCount} items to review`}>
          <button className="TopBar-review-badge" onClick={onOpenReview} aria-label="Open review">
            {unreviewedCount}
          </button>
        </Tooltip>
      )}
    </header>
  );
}
