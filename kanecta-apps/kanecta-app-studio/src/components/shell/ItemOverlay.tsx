import { useEffect } from 'react';
import IconButton from '@mui/material/IconButton';
import CloseIcon from '@mui/icons-material/Close';
import './ItemOverlay.scss';

interface ItemOverlayProps {
  open: boolean;
  onClose: () => void;
}

export function ItemOverlay({ open, onClose }: ItemOverlayProps) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="ItemOverlay" aria-modal="true" role="dialog">
      <div className="ItemOverlay-corner">Object</div>
      <div className="ItemOverlay-tabs">
        {['Item', 'Template'].map((t) => (
          <button key={t} className="ItemOverlay-tab">{t}</button>
        ))}
        <div className="ItemOverlay-tabs-spacer" />
        <IconButton className="ItemOverlay-close" onClick={onClose} aria-label="Close overlay">
          <CloseIcon />
        </IconButton>
      </div>
      <div className="ItemOverlay-sidebar">
        {['Value', 'Form', 'Yaml', 'JSON', 'Markdown'].map((v) => (
          <button key={v} className="ItemOverlay-view-btn">{v}</button>
        ))}
      </div>
      <div className="ItemOverlay-content" />
    </div>
  );
}
