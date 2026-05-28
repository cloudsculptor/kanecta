import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Tabs, Tab } from '@mui/material';
import { useWorkspaceStore } from '../../../store/workspace';
import type { ClipboardEntry } from '../../../api/index';
import './HistoryView.scss';

function ClipboardTab() {
  const { getApi, activeWorkspaceId } = useWorkspaceStore();

  const { data: entries = [], isLoading, error } = useQuery({
    queryKey: ['breadcrumb-clipboard', activeWorkspaceId],
    queryFn: () => getApi(activeWorkspaceId).breadcrumb.getClipboard(),
    refetchInterval: 5000,
  });

  if (isLoading) return <div className="HistoryView-empty">Loading…</div>;
  if (error) return <div className="HistoryView-empty">Failed to load clipboard history</div>;
  if (!entries.length) return <div className="HistoryView-empty">No clipboard history yet. Copy an item ID to get started.</div>;

  return (
    <div className="HistoryView-list">
      {entries.map((entry: ClipboardEntry, i: number) => (
        <div key={i} className="HistoryView-entry">
          <span className="HistoryView-entry-name">{entry.name}</span>
          <span className="HistoryView-entry-id">{entry.id}</span>
          <span className="HistoryView-entry-time">{new Date(entry.timestamp).toLocaleString()}</span>
        </div>
      ))}
    </div>
  );
}

export function HistoryView() {
  const [tab, setTab] = useState(0);

  return (
    <div className="HistoryView">
      <div className="HistoryView-tabs">
        <Tabs value={tab} onChange={(_, v) => setTab(v)}>
          <Tab label="Clipboard" />
          <Tab label="Viewed" />
        </Tabs>
      </div>
      <div className="HistoryView-content">
        {tab === 0 && <ClipboardTab />}
        {tab === 1 && <div className="HistoryView-empty">Viewed history coming soon.</div>}
      </div>
    </div>
  );
}
