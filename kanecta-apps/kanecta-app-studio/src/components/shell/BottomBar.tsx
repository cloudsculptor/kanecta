import Fab from '@mui/material/Fab';
import { useLocation } from '../../context/LocationContext';
import './BottomBar.scss';

interface BottomBarProps {
  onHome: () => void;
}

export function BottomBar({ onHome }: BottomBarProps) {
  const { overlayOpen, openOverlay, closeOverlay } = useLocation();

  return (
    <nav className={`BottomBar${overlayOpen ? ' BottomBar--raised' : ''}`}>
      <Fab
        onClick={() => overlayOpen ? closeOverlay() : openOverlay()}
        aria-label="Home"
        sx={{ bgcolor: '#ffffff', '&:hover': { bgcolor: '#f5f5f5' }, p: '6px', width: 56, height: 56, flexShrink: 0 }}
      >
        <img src="/logo.svg" alt="Kanecta" className="BottomBar-logo" />
      </Fab>
    </nav>
  );
}
