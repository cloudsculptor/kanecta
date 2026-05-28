import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import * as MuiIcons from '@mui/icons-material';
import ContentCopyIcon from '@mui/icons-material/ContentCopy';
import { useWorkspaceStore } from '../../store/workspace';
import type { TypeDefinition } from '../../api/types';
import './TypeList.scss';

export function TypeIcon({ name }: { name?: string | null }) {
  if (!name) return null;
  const Icon = (MuiIcons as Record<string, React.ElementType>)[name];
  return Icon ? <Icon fontSize="inherit" className="TypeList-icon" /> : null;
}

interface TypeListProps {
  selectedTypeId: string | null;
  onSelect: (type: TypeDefinition) => void;
  headerActions?: React.ReactNode;
  extraControls?: React.ReactNode;
}

export function TypeList({ selectedTypeId, onSelect, headerActions, extraControls }: TypeListProps) {
  const { getApi } = useWorkspaceStore();
  const [filter, setFilter] = useState('');
  const [detailed, setDetailed] = useState(false);

  const { data: types = [], isLoading } = useQuery({
    queryKey: ['types'],
    queryFn: () => getApi().types.list(),
  });

  const { data: stats } = useQuery({
    queryKey: ['items-stats'],
    queryFn: () => getApi().items.stats(),
  });

  const countByTypeId = new Map<string, number>(
    (stats?.structured ?? []).map(({ typeId, count }) => [typeId, count])
  );

  const filtered = filter.trim()
    ? types.filter((t) => {
        const q = filter.toLowerCase();
        return (
          t.value.toLowerCase().includes(q) ||
          (t.description ?? '').toLowerCase().includes(q) ||
          (t.keywords ?? '').toLowerCase().includes(q) ||
          (t.tags ?? '').toLowerCase().includes(q)
        );
      })
    : types;

  return (
    <div className="TypeList">
      <div className="TypeList-header">
        <div className="TypeList-filterrow">
          <input
            className="TypeList-input"
            placeholder="Filter types…"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
          />
          {headerActions}
        </div>
        {extraControls}
        <label className="TypeList-toggle">
          <input type="checkbox" checked={detailed} onChange={(e) => setDetailed(e.target.checked)} />
          Detailed view
        </label>
      </div>
      <div className="TypeList-items">
        {isLoading ? (
          <div className="TypeList-empty">Loading…</div>
        ) : filtered.length === 0 ? (
          <div className="TypeList-empty">{types.length === 0 ? 'No types' : 'No matches'}</div>
        ) : (
          filtered.map((t) => (
            <button
              key={t.id}
              className={`TypeList-item${selectedTypeId === t.id ? ' TypeList-item--active' : ''}`}
              onClick={() => onSelect(t)}
            >
              <TypeIcon name={t.icon} />
              <span className="TypeList-name">{t.value}</span>
              {countByTypeId.get(t.id) !== undefined && (
                <span className="TypeList-count">{countByTypeId.get(t.id)}</span>
              )}
              <div className="TypeList-sub">
                {detailed && t.description && <span className="TypeList-description">{t.description}</span>}
                {detailed && t.keywords && <span className="TypeList-keywords">{t.keywords}</span>}
                {detailed && t.tags && <span className="TypeList-tags">{t.tags}</span>}
                <div className="TypeList-uuid-row">
                  <span className="TypeList-id">{t.id}</span>
                  <button
                    className="TypeList-copy"
                    onClick={(e) => { e.stopPropagation(); void navigator.clipboard.writeText(t.id); }}
                    aria-label="Copy UUID"
                  >
                    <ContentCopyIcon className="TypeList-copy-icon" />
                  </button>
                </div>
              </div>
            </button>
          ))
        )}
      </div>
    </div>
  );
}
