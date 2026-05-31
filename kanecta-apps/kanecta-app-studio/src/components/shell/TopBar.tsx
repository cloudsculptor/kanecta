import SearchIcon from '@mui/icons-material/Search';
import AddIcon from '@mui/icons-material/Add';
import SettingsIcon from '@mui/icons-material/Settings';
import type { ViewType } from '../../types/ui';
import './TopBar.scss';

interface TopBarProps {
  onQuickCapture?: () => void;
  onCommandPalette?: () => void;
  onViewSelect: (view: ViewType) => void;
  activeView: ViewType;
}

export function TopBar({ onQuickCapture, onCommandPalette, onViewSelect, activeView }: TopBarProps) {
  return (
    <nav className="TopBar">
      <button className="TopBar-item" onClick={onCommandPalette} aria-label="Search">
        <SearchIcon />
        <span className="TopBar-item-label">Search</span>
      </button>
      <button className="TopBar-item" onClick={onQuickCapture} aria-label="Capture">
        <AddIcon />
        <span className="TopBar-item-label">Capture</span>
      </button>
      <button
        className={`TopBar-item${activeView === 'settings' ? ' TopBar-item--active' : ''}`}
        onClick={() => onViewSelect('settings')}
        aria-label="Settings"
        aria-current={activeView === 'settings' ? 'page' : undefined}
      >
        <SettingsIcon />
        <span className="TopBar-item-label">Settings</span>
      </button>
    </nav>
  );
}
