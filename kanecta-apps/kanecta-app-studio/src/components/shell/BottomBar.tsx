import Fab from '@mui/material/Fab';
import HistoryIcon from '@mui/icons-material/History';
import StarIcon from '@mui/icons-material/Star';
import { useLocation } from '../../context/LocationContext';
import type { ViewType } from '../../types/ui';
import './BottomBar.scss';

interface BottomBarProps {
  activeView: ViewType;
  onViewSelect: (view: ViewType) => void;
}

export function BottomBar({ activeView, onViewSelect }: BottomBarProps) {
  const { overlayOpen, openOverlay, closeOverlay } = useLocation();

  return (
    <nav className={`BottomBar${overlayOpen ? ' BottomBar--raised' : ''}`}>
      <button
        className={`BottomBar-item${activeView === 'starred' ? ' BottomBar-item--active' : ''}`}
        onClick={() => onViewSelect('starred')}
        aria-label="Starred"
        aria-current={activeView === 'starred' ? 'page' : undefined}
      >
        <StarIcon />
        <span className="BottomBar-item-label">Starred</span>
      </button>
      <Fab
        onClick={() => overlayOpen ? closeOverlay() : openOverlay()}
        aria-label="Home"
        sx={{ bgcolor: '#ffffff', '&:hover': { bgcolor: '#f5f5f5' }, p: '6px', width: 56, height: 56, flexShrink: 0 }}
      >
        <img src="/logo.svg" alt="Kanecta" className="BottomBar-logo" />
      </Fab>
      <button
        className={`BottomBar-item${activeView === 'history' ? ' BottomBar-item--active' : ''}`}
        onClick={() => onViewSelect('history')}
        aria-label="History"
        aria-current={activeView === 'history' ? 'page' : undefined}
      >
        <HistoryIcon />
        <span className="BottomBar-item-label">History</span>
      </button>
    </nav>
  );
}
