import { useState } from 'react';
import { IconButton, Tooltip, Dialog, DialogTitle, DialogContent, DialogContentText, DialogActions, Button } from '@mui/material';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import ChevronRightIcon from '@mui/icons-material/ChevronRight';
import AddIcon from '@mui/icons-material/Add';
import DeleteIcon from '@mui/icons-material/Delete';
import ZoomInIcon from '@mui/icons-material/ZoomIn';
import LooksTwoIcon from '@mui/icons-material/LooksTwo';
import Looks3Icon from '@mui/icons-material/Looks3';
import Looks4Icon from '@mui/icons-material/Looks4';
import Looks5Icon from '@mui/icons-material/Looks5';
import AddBoxIcon from '@mui/icons-material/AddBox';
import AddBoxRoundedIcon from '@mui/icons-material/AddBoxRounded';
import DataObjectIcon from '@mui/icons-material/DataObject';
import ContentCopyIcon from '@mui/icons-material/ContentCopy';
import FingerprintIcon from '@mui/icons-material/Fingerprint';
import CategoryIcon from '@mui/icons-material/Category';
import { TreeNodeEditor } from './TreeNodeEditor';
import { ItemValue } from '../../shared/ItemValue';
import { useItemLookup } from '../../../hooks/useItemLookup';
import { TYPE_ICONS } from '../../../lib/typeIcons';
import type { KanectaItem } from '../../../types/kanecta';
import './TreeNode.scss';

interface TreeNodeProps {
  item: KanectaItem;
  children?: React.ReactNode;
  isExpanded: boolean;
  hasChildren: boolean;
  onToggle: () => void;
  onEdit: (value: string) => Promise<void>;
  onAddChild: () => void;
  onAddSibling: () => void;
  onDelete: () => void;
  onZoom: () => void;
  onNavigateToId: (id: string) => void;
  onIndent: () => void;
  onOutdent: () => void;
  onFocus: () => void;
  onExpandToDepth: (depth: number | 'all') => void;
  onRecordClipboard: (type: string, typeId: string) => void;
  onRecordViewed: (type: string, typeId: string) => void;
  isFocused: boolean;
}

export function TreeNode({
  item,
  children,
  isExpanded,
  hasChildren,
  onToggle,
  onEdit,
  onAddChild,
  onAddSibling,
  onDelete,
  onZoom,
  onNavigateToId,
  onIndent,
  onOutdent,
  onFocus,
  onExpandToDepth,
  onRecordClipboard,
  onRecordViewed,
  isFocused,
}: TreeNodeProps) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const [confirmDelete, setConfirmDelete] = useState(false);
  const resolveId = useItemLookup();

  const startEdit = () => {
    setDraft(item.value);
    setEditing(true);
  };

  const commitEdit = async () => {
    setEditing(false);
    if (draft !== item.value && draft.trim()) {
      await onEdit(draft.trim());
    }
  };

  const abortEdit = () => {
    setEditing(false);
    setDraft(item.value);
  };

  return (
    <div className={`TreeNode TreeNode--confidence-${item.confidence}`}>
      <div
        className={`TreeNode-row${isFocused ? ' TreeNode-row--focused' : ''}`}
        onClick={onFocus}
      >
        <button
          className={`TreeNode-toggle${!hasChildren ? ' TreeNode-toggle--leaf' : ''}`}
          onClick={(e) => { e.stopPropagation(); if (hasChildren) onToggle(); }}
          aria-label={isExpanded ? 'Collapse' : 'Expand'}
          aria-expanded={hasChildren ? isExpanded : undefined}
          tabIndex={-1}
        >
          {hasChildren ? (
            isExpanded ? <ExpandMoreIcon sx={{ fontSize: '18px', width: '18px', height: '18px' }} /> : <ChevronRightIcon sx={{ fontSize: '18px', width: '18px', height: '18px' }} />
          ) : (
            <ExpandMoreIcon sx={{ fontSize: '18px', width: '18px', height: '18px' }} />
          )}
        </button>

        {(() => { const Icon = TYPE_ICONS[item.type]; return Icon ? <Icon className="TreeNode-bullet" onClick={(e) => { e.stopPropagation(); onZoom(); onRecordViewed(item.type, item.typeId ?? ''); }} /> : <span className="TreeNode-bullet" />; })()}

        {editing ? (
          <TreeNodeEditor
            value={draft}
            onChange={setDraft}
            onCommit={commitEdit}
            onAbort={abortEdit}
            onEnter={() => { void commitEdit().then(onAddSibling); }}
            onIndent={onIndent}
            onOutdent={onOutdent}
            onDeleteEmpty={onDelete}
          />
        ) : (
          <span
            className="TreeNode-label"
            onClick={(e) => { e.stopPropagation(); startEdit(); }}
          >
            <ItemValue value={item.value} resolveId={resolveId} onNavigate={onNavigateToId} />
          </span>
        )}

        <div className="TreeNode-actions">
          <Tooltip title="Copy value">
            <IconButton size="small" onClick={(e) => { e.stopPropagation(); void navigator.clipboard.writeText(item.value); }}>
              <ContentCopyIcon sx={{ fontSize: '18px', width: '18px', height: '18px' }} />
            </IconButton>
          </Tooltip>
          <Tooltip title="Copy ID">
            <IconButton size="small" onClick={(e) => { e.stopPropagation(); void navigator.clipboard.writeText(item.id); onRecordClipboard(item.type, item.typeId ?? ''); }}>
              <FingerprintIcon sx={{ fontSize: '18px', width: '18px', height: '18px' }} />
            </IconButton>
          </Tooltip>
          <Tooltip title={item.typeId ? 'Copy type ID' : 'No type ID (primitive type)'}>
            <span>
              <IconButton size="small" disabled={!item.typeId} onClick={(e) => { e.stopPropagation(); if (item.typeId) void navigator.clipboard.writeText(item.typeId); }}>
                <CategoryIcon sx={{ fontSize: '18px', width: '18px', height: '18px' }} />
              </IconButton>
            </span>
          </Tooltip>
          {([
            { depth: 2, Icon: LooksTwoIcon, label: 'Expand 2 levels' },
            { depth: 3, Icon: Looks3Icon,   label: 'Expand 3 levels' },
            { depth: 4, Icon: Looks4Icon,   label: 'Expand 4 levels' },
            { depth: 5, Icon: Looks5Icon,   label: 'Expand 5 levels' },
            { depth: 'all' as const, Icon: AddBoxIcon, label: 'Expand all' },
          ] as const).map(({ depth, Icon, label }) => (
            <Tooltip key={String(depth)} title={label}>
              <IconButton size="small" onClick={(e) => { e.stopPropagation(); onExpandToDepth(depth); }}>
                <Icon sx={{ fontSize: '18px', width: '18px', height: '18px' }} />
              </IconButton>
            </Tooltip>
          ))}
          <Tooltip title="Zoom in">
            <IconButton size="small" onClick={(e) => { e.stopPropagation(); onZoom(); onRecordViewed(item.type, item.typeId ?? ''); }}>
              <ZoomInIcon sx={{ fontSize: '18px', width: '18px', height: '18px' }} />
            </IconButton>
          </Tooltip>
          <Tooltip title="Add child">
            <IconButton size="small" onClick={(e) => { e.stopPropagation(); onAddChild(); }}>
              <AddIcon sx={{ fontSize: '18px', width: '18px', height: '18px' }} />
            </IconButton>
          </Tooltip>
          <Tooltip title="Delete">
            <IconButton size="small" onClick={(e) => { e.stopPropagation(); if (hasChildren) setConfirmDelete(true); else onDelete(); }}>
              <DeleteIcon sx={{ fontSize: '18px', width: '18px', height: '18px' }} />
            </IconButton>
          </Tooltip>
        </div>
      </div>

      {isExpanded && hasChildren && (
        <div className="TreeNode-children">{children}</div>
      )}

      <Dialog open={confirmDelete} onClose={() => setConfirmDelete(false)} onClick={(e) => e.stopPropagation()}>
        <DialogTitle>Delete "{item.value}"?</DialogTitle>
        <DialogContent>
          <DialogContentText>
            This item has children. Deleting it will also delete all of its descendants. This cannot be undone.
          </DialogContentText>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setConfirmDelete(false)}>Cancel</Button>
          <Button color="error" onClick={() => { setConfirmDelete(false); onDelete(); }}>Delete</Button>
        </DialogActions>
      </Dialog>
    </div>
  );
}
