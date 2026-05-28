import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { IconButton, Tooltip } from '@mui/material';
import ContentCopyIcon from '@mui/icons-material/ContentCopy';
import StarIcon from '@mui/icons-material/Star';
import { useWorkspaceStore } from '../../../store/workspace';
import { useUiStore } from '../../../store/ui';
import { TYPE_ICONS, FallbackIcon } from '../../../lib/typeIcons';
import type { ItemType } from '../../../types/kanecta';
import type { ClipboardEntry } from '../../../api/index';
import './StarredView.scss';

function TypeIcon({ type }: { type: string }) {
  const Icon = TYPE_ICONS[type as ItemType] ?? FallbackIcon;
  return <Icon className="StarredView-type-icon" />;
}

export function StarredView() {
  const { getApi } = useWorkspaceStore();
  const { layout, updatePanel } = useUiStore();
  const api = getApi();
  const qc = useQueryClient();
  const [removingId, setRemovingId] = useState<string | null>(null);

  const handleNavigate = (e: React.MouseEvent, id: string) => {
    e.preventDefault();
    window.location.hash = `/tree/${id}`;
    const panelId = layout.panels[0]?.id;
    if (panelId) updatePanel(panelId, { viewType: 'tree' });
  };

  const { data: entries = [], isLoading, error } = useQuery({
    queryKey: ['starred'],
    queryFn: () => api.starred.list(),
    refetchInterval: 5000,
  });

  const handleUnstar = async (id: string) => {
    setRemovingId(id);
    try {
      await api.starred.remove(id);
      await qc.invalidateQueries({ queryKey: ['starred'] });
    } finally {
      setRemovingId(null);
    }
  };

  const handleCopy = (id: string) => {
    void navigator.clipboard.writeText(id);
  };

  return (
    <div className="StarredView">
      <h2 className="StarredView-heading">Starred</h2>
      {isLoading && <div className="StarredView-empty">Loading…</div>}
      {error && <div className="StarredView-empty">Failed to load</div>}
      {!isLoading && !error && entries.length === 0 && (
        <div className="StarredView-empty">No starred items yet.</div>
      )}
      {!isLoading && !error && entries.length > 0 && (
        <div className="StarredView-list">
          {entries.map((entry: ClipboardEntry, i: number) => (
            <div key={i} className="StarredView-entry">
              <TypeIcon type={entry.type} />
              <a href={`/#/tree/${entry.id}`} className="StarredView-entry-name" onClick={(e) => handleNavigate(e, entry.id)}>{entry.name}</a>
              <Tooltip title="Copy UUID">
                <IconButton size="small" className="StarredView-action" onClick={() => handleCopy(entry.id)}>
                  <ContentCopyIcon />
                </IconButton>
              </Tooltip>
              <Tooltip title="Unstar">
                <IconButton
                  size="small"
                  className="StarredView-action StarredView-action--star"
                  onClick={() => void handleUnstar(entry.id)}
                  disabled={removingId === entry.id}
                >
                  <StarIcon />
                </IconButton>
              </Tooltip>
              <span className="StarredView-entry-time">{new Date(entry.timestamp).toLocaleString()}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
