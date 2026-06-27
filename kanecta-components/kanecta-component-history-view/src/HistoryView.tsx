import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { IconButton, Tooltip } from '@mui/material';
import ContentCopyIcon from '@mui/icons-material/ContentCopy';
import './HistoryView.css';

export interface HistoryEntry {
  id: string;
  name: string;
  type: string;
  timestamp: string;
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

export interface HistoryListProps {
  queryKey: string;
  fetcher: () => Promise<HistoryEntry[]>;
  emptyMessage: string;
  onNavigate: (e: React.MouseEvent, id: string) => void;
  getTypeIcon?: (type: string) => React.ElementType<{ className?: string }> | undefined;
}

export function HistoryList({ queryKey, fetcher, emptyMessage, onNavigate, getTypeIcon }: HistoryListProps) {
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
      {entries.map((entry, i) => {
        const Icon = getTypeIcon?.(entry.type);
        return (
          <div key={i} className="HistoryView-entry">
            {Icon && <Icon className="HistoryView-type-icon" />}
            <a
              href={`/#/tree/${entry.id}`}
              className="HistoryView-entry-name"
              onClick={(e) => onNavigate(e, entry.id)}
            >
              {entry.name}
            </a>
            <CopyUuidButton id={entry.id} />
            <span className="HistoryView-entry-time">{new Date(entry.timestamp).toLocaleString()}</span>
          </div>
        );
      })}
    </div>
  );
}

export interface HistoryViewProps {
  onFetchClipboard: () => Promise<HistoryEntry[]>;
  onFetchViewed: () => Promise<HistoryEntry[]>;
  onNavigate: (e: React.MouseEvent, id: string) => void;
  getTypeIcon?: (type: string) => React.ElementType<{ className?: string }> | undefined;
}

export function HistoryView({ onFetchClipboard, onFetchViewed, onNavigate, getTypeIcon }: HistoryViewProps) {
  return (
    <div className="HistoryView">
      <div className="HistoryView-column">
        <h2 className="HistoryView-heading">Clipboard History</h2>
        <HistoryList
          queryKey="breadcrumb-clipboard"
          fetcher={onFetchClipboard}
          emptyMessage="No clipboard history yet."
          onNavigate={onNavigate}
          getTypeIcon={getTypeIcon}
        />
      </div>
      <div className="HistoryView-divider" />
      <div className="HistoryView-column">
        <h2 className="HistoryView-heading">Navigation History</h2>
        <HistoryList
          queryKey="breadcrumb-viewed"
          fetcher={onFetchViewed}
          emptyMessage="No navigation history yet."
          onNavigate={onNavigate}
          getTypeIcon={getTypeIcon}
        />
      </div>
    </div>
  );
}
