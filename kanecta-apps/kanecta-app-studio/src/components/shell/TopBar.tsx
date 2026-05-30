import SearchIcon from '@mui/icons-material/Search';
import AddIcon from '@mui/icons-material/Add';
import SettingsIcon from '@mui/icons-material/Settings';
import './TopBar.scss';

interface TopBarProps {
  onQuickCapture?: () => void;
  onCommandPalette?: () => void;
  onOpenSettings?: () => void;
}

export function TopBar({ onQuickCapture, onCommandPalette, onOpenSettings }: TopBarProps) {
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
      <button className="TopBar-item" onClick={onOpenSettings} aria-label="Settings">
        <SettingsIcon />
        <span className="TopBar-item-label">Settings</span>
      </button>
    </nav>
  );
}
