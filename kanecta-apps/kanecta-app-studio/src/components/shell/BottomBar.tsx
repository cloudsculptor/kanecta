import Fab from '@mui/material/Fab';
import './BottomBar.scss';

interface BottomBarProps {
  onHome: () => void;
}

export function BottomBar({ onHome }: BottomBarProps) {
  return (
    <nav className="BottomBar">
      <Fab onClick={onHome} aria-label="Home" sx={{ bgcolor: '#ffffff', '&:hover': { bgcolor: '#f5f5f5' }, p: '6px', width: 56, height: 56 }}>
        <img src="/logo.svg" alt="Kanecta" className="BottomBar-logo" />
      </Fab>
    </nav>
  );
}
