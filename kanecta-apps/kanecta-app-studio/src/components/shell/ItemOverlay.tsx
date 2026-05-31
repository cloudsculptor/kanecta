import { useEffect, useState } from 'react';
import IconButton from '@mui/material/IconButton';
import CloseIcon from '@mui/icons-material/Close';
import { useLocation } from '../../context/LocationContext';
import { ItemDetail } from '../item/ItemDetail';
import './ItemOverlay.scss';

const SIDEBAR_TABS = ['Details', 'Value', 'Form', 'Yaml', 'JSON', 'Markdown'] as const;
type SidebarTab = typeof SIDEBAR_TABS[number];

const HEADER_TABS = ['Item', 'Template'] as const;
type HeaderTab = typeof HEADER_TABS[number];

export function ItemOverlay() {
  const { overlayOpen, closeOverlay, itemId } = useLocation();
  const [headerTab, setHeaderTab] = useState<HeaderTab>('Item');
  const [sidebarTab, setSidebarTab] = useState<SidebarTab>('Details');

  useEffect(() => {
    if (!overlayOpen) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') closeOverlay(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [overlayOpen, closeOverlay]);

  if (!overlayOpen) return null;

  return (
    <div className="ItemOverlay" aria-modal="true" role="dialog">
      <div className="ItemOverlay-corner">Object</div>
      <div className="ItemOverlay-tabs">
        {HEADER_TABS.map((t) => (
          <button
            key={t}
            className={`ItemOverlay-tab${headerTab === t ? ' ItemOverlay-tab--active' : ''}`}
            onClick={() => setHeaderTab(t)}
          >
            {t}
          </button>
        ))}
        <div className="ItemOverlay-tabs-spacer" />
        <IconButton className="ItemOverlay-close" onClick={closeOverlay} aria-label="Close overlay">
          <CloseIcon />
        </IconButton>
      </div>
      <div className="ItemOverlay-sidebar">
        {SIDEBAR_TABS.map((v) => (
          <button
            key={v}
            className={`ItemOverlay-view-btn${sidebarTab === v ? ' ItemOverlay-view-btn--active' : ''}`}
            onClick={() => setSidebarTab(v)}
          >
            {v}
          </button>
        ))}
      </div>
      <div className="ItemOverlay-content">
        {sidebarTab === 'Details' && itemId && <ItemDetail itemId={itemId} />}
        {sidebarTab === 'Details' && !itemId && (
          <div className="ItemOverlay-empty">No item selected</div>
        )}
      </div>
    </div>
  );
}
