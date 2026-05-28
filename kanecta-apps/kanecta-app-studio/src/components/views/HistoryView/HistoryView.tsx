import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { IconButton, Tooltip } from '@mui/material';
import ContentCopyIcon from '@mui/icons-material/ContentCopy';
import { useWorkspaceStore } from '../../../store/workspace';
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

function HistoryList({ queryKey, fetcher, emptyMessage }: {
  queryKey: string;
  fetcher: () => Promise<ClipboardEntry[]>;
  emptyMessage: string;
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
          <span className="HistoryView-entry-name">{entry.name}</span>
          <CopyUuidButton id={entry.id} />
          <span className="HistoryView-entry-time">{new Date(entry.timestamp).toLocaleString()}</span>
        </div>
      ))}
    </div>
  );
}

export function HistoryView() {
  const { getApi, activeWorkspaceId } = useWorkspaceStore();
  const api = getApi(activeWorkspaceId);

  return (
    <div className="HistoryView">
      <div className="HistoryView-column">
        <h2 className="HistoryView-heading">Clipboard History</h2>
        <HistoryList
          queryKey="breadcrumb-clipboard"
          fetcher={() => api.breadcrumb.getClipboard()}
          emptyMessage="No clipboard history yet."
        />
      </div>
      <div className="HistoryView-divider" />
      <div className="HistoryView-column">
        <h2 className="HistoryView-heading">Navigation History</h2>
        <HistoryList
          queryKey="breadcrumb-viewed"
          fetcher={() => api.breadcrumb.getViewed()}
          emptyMessage="No navigation history yet."
        />

      </div>
    </div>
  );
}
