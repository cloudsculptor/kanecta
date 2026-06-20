import { useState } from 'react';
import HomeIcon from '@mui/icons-material/Home';
import SearchIcon from '@mui/icons-material/Search';
import AddIcon from '@mui/icons-material/Add';
import SettingsIcon from '@mui/icons-material/Settings';
import type { ViewType } from '../../types/ui';
import { useLocation } from '../../context/LocationContext';
import { api } from '../../api';
import { AccountMenu } from './AccountMenu';
import { DatastoreSwitcher } from './DatastoreSwitcher';
import './TopBar.scss';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface TopBarProps {
  onQuickCapture?: () => void;
  onCommandPalette?: () => void;
  onViewSelect: (view: ViewType) => void;
  activeView: ViewType;
}

export function TopBar({ onQuickCapture, onCommandPalette, onViewSelect, activeView }: TopBarProps) {
  const [value, setValue] = useState('');
  const { setItemId } = useLocation();

  const activeClass = (view: ViewType) =>
    activeView === view ? ' TopBar-item--active' : '';

  const handleKeyDown = async (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key !== 'Enter') return;
    const input = value.trim();
    if (!input) return;

    if (UUID_RE.test(input)) {
      setItemId(input);
      window.location.hash = `/tree/${input}`;
      setValue('');
      return;
    }

    try {
      const entry = await api.aliases.resolve(input.toLowerCase());
      setItemId(entry.targetId);
      window.location.hash = `/tree/${entry.targetId}`;
      setValue('');
    } catch {
      // alias not found — leave input as-is so user can see it failed
    }
  };

  return (
    <nav className="TopBar">
      <DatastoreSwitcher />
      <button
        className={`TopBar-item${activeClass('home')}`}
        onClick={() => onViewSelect('home')}
        aria-label="Home"
        aria-current={activeView === 'home' ? 'page' : undefined}
      >
        <HomeIcon />
        <span className="TopBar-item-label">Home</span>
      </button>
      <button className="TopBar-item" onClick={onCommandPalette} aria-label="Search">
        <SearchIcon />
        <span className="TopBar-item-label">Search</span>
      </button>
      <div className="TopBar-input-wrap">
        <input
          className="TopBar-input"
          type="text"
          placeholder=""
          aria-label="Navigate to item"
          value={value}
          onChange={e => setValue(e.target.value)}
          onKeyDown={handleKeyDown}
        />
      </div>
      <button className="TopBar-item" onClick={onQuickCapture} aria-label="Capture">
        <AddIcon />
        <span className="TopBar-item-label">Capture</span>
      </button>
      <button
        className={`TopBar-item${activeClass('settings')}`}
        onClick={() => onViewSelect('settings')}
        aria-label="Settings"
        aria-current={activeView === 'settings' ? 'page' : undefined}
      >
        <SettingsIcon />
        <span className="TopBar-item-label">Settings</span>
      </button>
      <div className="TopBar-account">
        <AccountMenu />
      </div>
    </nav>
  );
}
