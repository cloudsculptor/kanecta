import { useState } from 'react';
import Fab from '@mui/material/Fab';
import { ItemOverlay } from './ItemOverlay';
import { useLocation } from '../../context/LocationContext';
import './BottomBar.scss';

interface BottomBarProps {
  onHome: () => void;
}

export function BottomBar({ onHome }: BottomBarProps) {
  const [overlayOpen, setOverlayOpen] = useState(false);
  const { viewId, itemId } = useLocation();

  return (
    <>
      <ItemOverlay open={overlayOpen} onClose={() => setOverlayOpen(false)} />
      <nav className={`BottomBar${overlayOpen ? ' BottomBar--raised' : ''}`}>
        <div className="BottomBar-location">
          <input
            className="BottomBar-location-input"
            type="text"
            placeholder="View"
            aria-label="View"
            readOnly
            value={viewId ?? ''}
          />
        </div>
        <Fab onClick={() => setOverlayOpen(o => !o)} aria-label="Home" sx={{ bgcolor: '#ffffff', '&:hover': { bgcolor: '#f5f5f5' }, p: '6px', width: 56, height: 56, flexShrink: 0 }}>
          <img src="/logo.svg" alt="Kanecta" className="BottomBar-logo" />
        </Fab>
        <div className="BottomBar-location">
          <input
            className="BottomBar-location-input"
            type="text"
            placeholder="Item"
            aria-label="Item"
            readOnly
            value={itemId ?? ''}
          />
        </div>
      </nav>
    </>
  );
}
