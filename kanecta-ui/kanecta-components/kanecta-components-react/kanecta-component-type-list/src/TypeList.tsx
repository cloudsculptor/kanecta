import { useState } from 'react';
import * as MuiIcons from '@mui/icons-material';
import ContentCopyIcon from '@mui/icons-material/ContentCopy';
import MoreHorizIcon from '@mui/icons-material/MoreHoriz';
import Menu from '@mui/material/Menu';
import MenuItem from '@mui/material/MenuItem';
import './TypeList.scss';

export interface TypeItem {
  id: string;
  value: string;
  icon?: string | null;
  description?: string | null;
  keywords?: string | null;
  tags?: string | null;
}

export function TypeIcon({ name }: { name?: string | null }) {
  if (!name) return null;
  const Icon = (MuiIcons as Record<string, React.ElementType>)[name];
  return Icon ? <Icon fontSize="inherit" className="TypeList-icon" /> : null;
}

export interface TypeListProps<T extends TypeItem = TypeItem> {
  types: T[];
  countByTypeId?: Map<string, number>;
  isLoading?: boolean;
  selectedTypeId: string | null;
  onSelect: (type: T) => void;
  onCreateItem?: (type: T) => void;
  headerActions?: React.ReactNode;
  extraControls?: React.ReactNode;
}

export function TypeList<T extends TypeItem = TypeItem>({
  types,
  countByTypeId,
  isLoading,
  selectedTypeId,
  onSelect,
  onCreateItem,
  headerActions,
  extraControls,
}: TypeListProps<T>) {
  const [filter, setFilter] = useState('');
  const [detailed, setDetailed] = useState(false);
  const [menuAnchor, setMenuAnchor] = useState<HTMLElement | null>(null);
  const [menuType, setMenuType] = useState<T | null>(null);

  const q = filter.trim().toLowerCase();
  const filtered = q
    ? types.filter((t) =>
        // Every field is guarded — a type with a null/absent `value` (or any
        // other field) must not crash the filter. Previously t.value.toLowerCase()
        // threw when value was missing, taking down the whole view.
        (t.value ?? '').toLowerCase().includes(q) ||
        (t.description ?? '').toLowerCase().includes(q) ||
        (t.keywords ?? '').toLowerCase().includes(q) ||
        (t.tags ?? '').toLowerCase().includes(q),
      )
    : types;

  const openMenu = (e: React.MouseEvent<HTMLButtonElement>, t: T) => {
    e.stopPropagation();
    setMenuAnchor(e.currentTarget);
    setMenuType(t);
  };

  const closeMenu = () => { setMenuAnchor(null); setMenuType(null); };

  const handleCreate = () => {
    if (menuType) onCreateItem?.(menuType);
    closeMenu();
  };

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
              {countByTypeId?.get(t.id) !== undefined && (
                <span className="TypeList-count">{countByTypeId.get(t.id)}</span>
              )}
              <button
                className="TypeList-menu-btn"
                onClick={(e) => openMenu(e, t)}
                aria-label="More options"
              >
                <MoreHorizIcon fontSize="small" />
              </button>
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

      <Menu anchorEl={menuAnchor} open={Boolean(menuAnchor)} onClose={closeMenu}>
        <MenuItem onClick={handleCreate}>Create</MenuItem>
      </Menu>
    </div>
  );
}
