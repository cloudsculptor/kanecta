import { useState } from 'react';
import type { ViewMeta } from '../../../lib/viewMeta';
import { useViewLocation } from '../../../context/LocationContext';

export const HistoryViewMeta: ViewMeta = {
  uuid: 'a4f3b2c1-d5e6-4f7a-8b9c-0d1e2f3a4b5c',
  name: 'history',
  label: 'History',
  icon: 'History',
};
import { useQuery } from '@tanstack/react-query';
import { IconButton, Tooltip } from '@mui/material';
import ContentCopyIcon from '@mui/icons-material/ContentCopy';
import { useWorkspaceStore } from '../../../store/workspace';
import { useUiStore } from '../../../store/ui';
import { TYPE_ICONS, FallbackIcon } from '../../../lib/typeIcons';
import type { ItemType } from '../../../types/kanecta';
import type { ClipboardEntry } from '../../../api/index';
import './HistoryView.scss';

function TypeIcon({ type }: { type: string }) {
  const Icon = TYPE_ICONS[type as ItemType] ?? FallbackIcon;
  return <Icon className="HistoryView-type-icon" />;
}

function CopyUuidButton({ id }: { id: string }) {
  const [copied, setCopied] = useState(false);
  const handleCopy = () => {
    void navigator.clipboard.writeText(id);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };
  return (
    <Tooltip title={copied ? 'Copied!' : 'Copy UUID'}>
      <IconButton size="small" className="HistoryView-copy" onClick={handleCopy}>
        <ContentCopyIcon />
      </IconButton>
    </Tooltip>
  );
}

export function HistoryList({ queryKey, fetcher, emptyMessage, onNavigate }: {
  queryKey: string;
  fetcher: () => Promise<ClipboardEntry[]>;
  emptyMessage: string;
  onNavigate: (e: React.MouseEvent, id: string) => void;
}) {
  const { data: entries = [], isLoading, error } = useQuery({
    queryKey: [queryKey],
    queryFn: fetcher,
    refetchInterval: 5000,
  });

  if (isLoading) return <div className="HistoryView-empty">Loading…</div>;
  if (error) return <div className="HistoryView-empty">Failed to load</div>;
  if (!entries.length) return <div className="HistoryView-empty">{emptyMessage}</div>;

  return (
    <div className="HistoryView-list">
      {entries.map((entry, i) => (
        <div key={i} className="HistoryView-entry">
          <TypeIcon type={entry.type} />
          <a href={`/#/tree/${entry.id}`} className="HistoryView-entry-name" onClick={(e) => onNavigate(e, entry.id)}>{entry.name}</a>
          <CopyUuidButton id={entry.id} />
          <span className="HistoryView-entry-time">{new Date(entry.timestamp).toLocaleString()}</span>
        </div>
      ))}
    </div>
  );
}

export function HistoryView() {
  useViewLocation(HistoryViewMeta.uuid);
  const { getApi, activeWorkspaceId } = useWorkspaceStore();
  const { layout, updatePanel } = useUiStore();
  const api = getApi(activeWorkspaceId);

  const handleNavigate = (e: React.MouseEvent, id: string) => {
    e.preventDefault();
    window.location.hash = `/tree/${id}`;
    const panelId = layout.panels[0]?.id;
    if (panelId) updatePanel(panelId, { viewType: 'tree' });
  };

  return (
    <div className="HistoryView">
      <div className="HistoryView-column">
        <h2 className="HistoryView-heading">Clipboard History</h2>
        <HistoryList
          queryKey="breadcrumb-clipboard"
          fetcher={() => api.breadcrumb.getClipboard()}
          emptyMessage="No clipboard history yet."
          onNavigate={handleNavigate}
        />
      </div>
      <div className="HistoryView-divider" />
      <div className="HistoryView-column">
        <h2 className="HistoryView-heading">Navigation History</h2>
        <HistoryList
          queryKey="breadcrumb-viewed"
          fetcher={() => api.breadcrumb.getViewed()}
          emptyMessage="No navigation history yet."
          onNavigate={handleNavigate}
        />
      </div>
    </div>
  );
}
