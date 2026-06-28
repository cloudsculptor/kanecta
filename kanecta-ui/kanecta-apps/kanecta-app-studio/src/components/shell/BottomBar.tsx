import Fab from '@mui/material/Fab';
import ChecklistIcon from '@mui/icons-material/Checklist';
import DashboardIcon from '@mui/icons-material/Dashboard';
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

  const item = (view: ViewType, label: string, icon: React.ReactNode) => (
    <button
      className={`BottomBar-item${activeView === view ? ' BottomBar-item--active' : ''}`}
      onClick={() => onViewSelect(view)}
      aria-label={label}
      aria-current={activeView === view ? 'page' : undefined}
    >
      {icon}
      <span className="BottomBar-item-label">{label}</span>
    </button>
  );

  return (
    <nav className={`BottomBar${overlayOpen ? ' BottomBar--raised' : ''}`}>
      <div className="BottomBar-bottomLeftCorner" />
      <div className="BottomBar-center">
        {item('starred', 'Starred', <StarIcon />)}
        {item('history', 'History', <HistoryIcon />)}
        <Fab
          onClick={() => overlayOpen ? closeOverlay() : openOverlay()}
          aria-label="Home"
          sx={{ bgcolor: '#ffffff', '&:hover': { bgcolor: '#f5f5f5' }, p: '6px', width: 56, height: 56, flexShrink: 0 }}
        >
          <img src="/logo.svg" alt="Kanecta" className="BottomBar-logo" />
        </Fab>
        {item('layouts', 'Layouts', <DashboardIcon />)}
        {item('todo', 'Todo', <ChecklistIcon />)}
      </div>
      <div className="BottomBar-bottomRightCorner" />
    </nav>
  );
}
