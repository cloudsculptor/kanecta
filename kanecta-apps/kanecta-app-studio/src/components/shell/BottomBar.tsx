import Fab from '@mui/material/Fab';
import './BottomBar.scss';

interface BottomBarProps {
  onHome: () => void;
}

export function BottomBar({ onHome }: BottomBarProps) {
  return (
    <nav className="BottomBar">
      <div className="BottomBar-location">
        <input className="BottomBar-location-input" type="text" placeholder="View" aria-label="View" />
      </div>
      <Fab onClick={onHome} aria-label="Home" sx={{ bgcolor: '#ffffff', '&:hover': { bgcolor: '#f5f5f5' }, p: '6px', width: 56, height: 56, flexShrink: 0 }}>
        <img src="/logo.svg" alt="Kanecta" className="BottomBar-logo" />
      </Fab>
      <div className="BottomBar-location">
        <input className="BottomBar-location-input" type="text" placeholder="Item" aria-label="Item" />
      </div>
    </nav>
  );
}
