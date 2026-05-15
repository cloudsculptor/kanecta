import { IconButton, Tooltip } from '@mui/material';
import SearchIcon from '@mui/icons-material/Search';
import AddIcon from '@mui/icons-material/Add';
import './TopBar.scss';

interface TopBarProps {
  onQuickCapture?: () => void;
  onCommandPalette?: () => void;
}

export function TopBar({ onQuickCapture, onCommandPalette }: TopBarProps) {
  return (
    <header className="TopBar">
      <span className="TopBar-logo">kanecta</span>
      <div className="TopBar-spacer" />
      <Tooltip title="Command palette (Ctrl+K)">
        <IconButton size="small" onClick={onCommandPalette} aria-label="Command palette">
          <SearchIcon fontSize="small" />
        </IconButton>
      </Tooltip>
      <Tooltip title="Quick capture (Ctrl+Space)">
        <IconButton size="small" onClick={onQuickCapture} aria-label="Quick capture">
          <AddIcon fontSize="small" />
        </IconButton>
      </Tooltip>
    </header>
  );
}
