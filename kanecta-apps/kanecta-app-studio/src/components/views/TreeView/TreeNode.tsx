import { useState } from 'react';
import { IconButton, Tooltip } from '@mui/material';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import ChevronRightIcon from '@mui/icons-material/ChevronRight';
import AddIcon from '@mui/icons-material/Add';
import DeleteIcon from '@mui/icons-material/Delete';
import ZoomInIcon from '@mui/icons-material/ZoomIn';
import { TreeNodeEditor } from './TreeNodeEditor';
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
  onIndent: () => void;
  onOutdent: () => void;
  onFocus: () => void;
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
  onIndent,
  onOutdent,
  onFocus,
  isFocused,
}: TreeNodeProps) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');

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
            isExpanded ? <ExpandMoreIcon sx={{ fontSize: 14 }} /> : <ChevronRightIcon sx={{ fontSize: 14 }} />
          ) : (
            <ExpandMoreIcon sx={{ fontSize: 14 }} />
          )}
        </button>

        <span className="TreeNode-bullet" />

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
            title={item.value}
            onClick={(e) => { e.stopPropagation(); startEdit(); }}
          >
            {item.value}
          </span>
        )}

        <div className="TreeNode-actions">
          <Tooltip title="Zoom in">
            <IconButton size="small" onClick={(e) => { e.stopPropagation(); onZoom(); }}>
              <ZoomInIcon sx={{ fontSize: 14 }} />
            </IconButton>
          </Tooltip>
          <Tooltip title="Add child">
            <IconButton size="small" onClick={(e) => { e.stopPropagation(); onAddChild(); }}>
              <AddIcon sx={{ fontSize: 14 }} />
            </IconButton>
          </Tooltip>
          <Tooltip title="Delete">
            <IconButton size="small" onClick={(e) => { e.stopPropagation(); onDelete(); }}>
              <DeleteIcon sx={{ fontSize: 14 }} />
            </IconButton>
          </Tooltip>
        </div>
      </div>

      {isExpanded && hasChildren && (
        <div className="TreeNode-children">{children}</div>
      )}
    </div>
  );
}
