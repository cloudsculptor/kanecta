import { useState, useEffect } from 'react';
import Fab from '@mui/material/Fab';
import IconButton from '@mui/material/IconButton';
import CloseIcon from '@mui/icons-material/Close';
import './BottomBar.scss';

interface BottomBarProps {
  onHome: () => void;
}

export function BottomBar({ onHome }: BottomBarProps) {
  const [overlayOpen, setOverlayOpen] = useState(false);

  useEffect(() => {
    if (!overlayOpen) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOverlayOpen(false); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [overlayOpen]);

  const handleFabClick = () => {
    if (overlayOpen) { setOverlayOpen(false); }
    else { setOverlayOpen(true); }
  };

  return (
    <>
      {overlayOpen && (
        <div className="BottomBar-overlay" aria-modal="true" role="dialog">
          <div className="BottomBar-overlay-tabs">
            {['Item', 'Template'].map((t) => (
              <button key={t} className="BottomBar-overlay-tab">{t}</button>
            ))}
            <div className="BottomBar-overlay-tabs-spacer" />
            <IconButton className="BottomBar-overlay-close" onClick={() => setOverlayOpen(false)} aria-label="Close overlay">
              <CloseIcon />
            </IconButton>
          </div>
          <div className="BottomBar-overlay-sidebar">
            {['Value', 'Form', 'Yaml', 'JSON', 'Markdown'].map((v) => (
              <button key={v} className="BottomBar-overlay-view-btn">{v}</button>
            ))}
          </div>
          <div className="BottomBar-overlay-content" />
        </div>
      )}
      <nav className={`BottomBar${overlayOpen ? ' BottomBar--raised' : ''}`}>
        <div className="BottomBar-location">
          <input className="BottomBar-location-input" type="text" placeholder="View" aria-label="View" />
        </div>
        <Fab onClick={handleFabClick} aria-label="Home" sx={{ bgcolor: '#ffffff', '&:hover': { bgcolor: '#f5f5f5' }, p: '6px', width: 56, height: 56, flexShrink: 0 }}>
          <img src="/logo.svg" alt="Kanecta" className="BottomBar-logo" />
        </Fab>
        <div className="BottomBar-location">
          <input className="BottomBar-location-input" type="text" placeholder="Item" aria-label="Item" />
        </div>
      </nav>
    </>
  );
}
