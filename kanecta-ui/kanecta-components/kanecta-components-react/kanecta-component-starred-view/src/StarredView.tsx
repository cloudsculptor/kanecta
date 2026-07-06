import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { IconButton, Tooltip } from '@mui/material';
import ContentCopyIcon from '@mui/icons-material/ContentCopy';
import StarIcon from '@mui/icons-material/Star';
import './StarredView.scss';

export interface StarredEntry {
  id: string;
  name: string;
  type: string;
  timestamp: string;
}

export interface StarredViewProps {
  onFetch: () => Promise<StarredEntry[]>;
  onUnstar: (id: string) => Promise<unknown>;
  onNavigate: (e: React.MouseEvent, id: string) => void;
  getTypeIcon?: (type: string) => React.ElementType<{ className?: string }> | undefined;
}

export function StarredView({ onFetch, onUnstar, onNavigate, getTypeIcon }: StarredViewProps) {
  const qc = useQueryClient();
  const [removingId, setRemovingId] = useState<string | null>(null);

  const { data: entries = [], isLoading, error } = useQuery({
    queryKey: ['starred-view'],
    queryFn: onFetch,
    refetchInterval: 5000,
  });

  const handleUnstar = async (id: string) => {
    setRemovingId(id);
    try {
      await onUnstar(id);
      await qc.invalidateQueries({ queryKey: ['starred-view'] });
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
          {entries.map((entry, i) => {
            const Icon = getTypeIcon?.(entry.type);
            return (
              <div key={i} className="StarredView-entry">
                {Icon && <Icon className="StarredView-type-icon" />}
                <a
                  href={`/#/tree/${entry.id}`}
                  className="StarredView-entry-name"
                  onClick={(e) => onNavigate(e, entry.id)}
                >
                  {entry.name}
                </a>
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
            );
          })}
        </div>
      )}
    </div>
  );
}
