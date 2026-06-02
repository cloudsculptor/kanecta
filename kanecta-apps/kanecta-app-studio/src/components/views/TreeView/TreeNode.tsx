import { useEffect, useRef, useState } from 'react';
import { IconButton, Tooltip, Dialog, DialogTitle, DialogContent, DialogContentText, DialogActions, Button, List, ListItemButton, ListItemText, CircularProgress } from '@mui/material';
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
import DataObjectIcon from '@mui/icons-material/DataObject';
import ContentCopyIcon from '@mui/icons-material/ContentCopy';
import DifferenceOutlinedIcon from '@mui/icons-material/DifferenceOutlined';
import FileCopyOutlinedIcon from '@mui/icons-material/FileCopyOutlined';
import CategoryIcon from '@mui/icons-material/Category';
import TransformIcon from '@mui/icons-material/Transform';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { TreeNodeEditor } from './TreeNodeEditor';
import { ItemValue } from '../../shared/ItemValue';
import { DynamicIcon } from '../../shared/DynamicIcon';
import { useItemLookup } from '../../../hooks/useItemLookup';
import { useWorkspaceStore } from '../../../store/workspace';
import { TYPE_ICONS } from '../../../lib/typeIcons';
import type { KanectaItem, ItemType } from '../../../types/kanecta';
import type { TypeDefinition } from '../../../api/types';
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
  onCopyObject?: () => Promise<void>;
  onCopyAs: () => void;
  isFocused: boolean;
  autoFocusEdit?: boolean;
  onAutoFocused?: () => void;
  setItemId: (id: string | null) => void;
  openOverlay: () => void;
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
  onCopyObject,
  onCopyAs,
  isFocused,
  autoFocusEdit,
  onAutoFocused,
  setItemId,
  openOverlay,
}: TreeNodeProps) {
  const [editing, setEditing] = useState(false);
  const [initialDraft, setInitialDraft] = useState('');
  const draftRef = useRef('');
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [convertOpen, setConvertOpen] = useState(false);
  const [converting, setConverting] = useState(false);
  const resolveId = useItemLookup();
  const { getApi } = useWorkspaceStore();
  const queryClient = useQueryClient();

  const { data: types = [], isLoading: typesLoading } = useQuery({
    queryKey: ['types'],
    queryFn: () => getApi().types.list(),
    enabled: convertOpen,
  });

  const handleConvert = async (target: TypeDefinition) => {
    setConverting(true);
    try {
      await getApi().items.update(item.id, { type: target.value as ItemType, typeId: target.id });
      await queryClient.invalidateQueries({ queryKey: ['tree'] });
      setConvertOpen(false);
    } finally {
      setConverting(false);
    }
  };

  const startEdit = () => {
    draftRef.current = item.value;
    setInitialDraft(item.value);
    setEditing(true);
  };

  useEffect(() => {
    if (autoFocusEdit) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      startEdit();
      onAutoFocused?.();
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const commitEdit = async () => {
    setEditing(false);
    const value = draftRef.current;
    if (value !== item.value && value.trim()) {
      await onEdit(value.trim());
    }
  };

  const abortEdit = () => {
    setEditing(false);
  };

  const isSynthetic = item._synthetic || item._hasObject;

  return (
    <div className={`TreeNode TreeNode--confidence-${item.confidence}${isSynthetic ? ' TreeNode--synthetic' : ''}`}>
      <div
        className={`TreeNode-row${isFocused ? ' TreeNode-row--focused' : ''}`}
        onClick={() => { onFocus(); if (!isSynthetic) startEdit(); }}
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

        {item.icon && !item._synthetic
          ? <DynamicIcon name={item.icon} className="TreeNode-bullet" onClick={(e) => { e.stopPropagation(); onZoom(); onRecordViewed(item.type, item.typeId ?? ''); }} />
          : (() => { const Icon = TYPE_ICONS[item._synthetic ? 'text' : item.type]; return Icon ? <Icon className="TreeNode-bullet" onClick={(e) => { e.stopPropagation(); onZoom(); onRecordViewed(item.type, item.typeId ?? ''); }} /> : <span className="TreeNode-bullet" />; })()
        }

        {editing && !isSynthetic ? (
          <TreeNodeEditor
            value={initialDraft}
            onChange={(val) => { draftRef.current = val; }}
            onCommit={commitEdit}
            onAbort={abortEdit}
            onEnter={() => { void commitEdit().then(onAddSibling); }}
            onIndent={() => { void commitEdit().then(onIndent); }}
            onOutdent={onOutdent}
            onDeleteEmpty={onDelete}
          />
        ) : (
          <span
            className="TreeNode-label"
          >
            <ItemValue value={item.value} resolveId={resolveId} onNavigate={onNavigateToId} />
          </span>
        )}

        <div className="TreeNode-actions">
          <Tooltip title="Details">
            <IconButton size="small" onClick={(e) => { e.stopPropagation(); setItemId(item.id); openOverlay(); }}>
              <img src="/logo.svg" alt="Kanecta" style={{ width: 30, height: 30, display: 'block', objectFit: 'contain' }} />
            </IconButton>
          </Tooltip>
          <Tooltip title="Copy ID">
            <IconButton size="small" onClick={(e) => { e.stopPropagation(); void navigator.clipboard.writeText(item.id); onRecordClipboard(item.type, item.typeId ?? ''); }}>
              <ContentCopyIcon sx={{ fontSize: '18px', width: '18px', height: '18px' }} />
            </IconButton>
          </Tooltip>
          <Tooltip title="Copy value">
            <IconButton size="small" onClick={(e) => { e.stopPropagation(); void navigator.clipboard.writeText(item.value); }}>
              <DifferenceOutlinedIcon sx={{ fontSize: '18px', width: '18px', height: '18px' }} />
            </IconButton>
          </Tooltip>
          {item.typeId && (
            <Tooltip title="Copy type ID">
              <IconButton size="small" onClick={(e) => { e.stopPropagation(); void navigator.clipboard.writeText(item.typeId!); }}>
                <CategoryIcon sx={{ fontSize: '18px', width: '18px', height: '18px' }} />
              </IconButton>
            </Tooltip>
          )}
          {item._hasObject && onCopyObject && (
            <Tooltip title="Copy object JSON">
              <IconButton size="small" onClick={(e) => { e.stopPropagation(); void onCopyObject(); }}>
                <DataObjectIcon sx={{ fontSize: '18px', width: '18px', height: '18px' }} />
              </IconButton>
            </Tooltip>
          )}
          <Tooltip title="Copy as">
            <IconButton size="small" onClick={(e) => { e.stopPropagation(); onCopyAs(); }}>
              <FileCopyOutlinedIcon sx={{ fontSize: '18px', width: '18px', height: '18px' }} />
            </IconButton>
          </Tooltip>
          {!isSynthetic && (
            <Tooltip title="Convert">
              <IconButton size="small" onClick={(e) => { e.stopPropagation(); setConvertOpen(true); }}>
                <TransformIcon sx={{ fontSize: '18px', width: '18px', height: '18px' }} />
              </IconButton>
            </Tooltip>
          )}
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
          {!item._synthetic && (
            <Tooltip title="Zoom in">
              <IconButton size="small" onClick={(e) => { e.stopPropagation(); onZoom(); onRecordViewed(item.type, item.typeId ?? ''); }}>
                <ZoomInIcon sx={{ fontSize: '18px', width: '18px', height: '18px' }} />
              </IconButton>
            </Tooltip>
          )}
          {!isSynthetic && (
            <>
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
            </>
          )}
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

      <Dialog open={convertOpen} onClose={() => !converting && setConvertOpen(false)} onClick={(e) => e.stopPropagation()} maxWidth="xs" fullWidth>
        <DialogTitle>Convert "{item.value}"</DialogTitle>
        <DialogContent sx={{ p: 0 }}>
          {typesLoading ? (
            <div style={{ display: 'flex', justifyContent: 'center', padding: '24px' }}>
              <CircularProgress size={24} />
            </div>
          ) : (
            <List dense disablePadding>
              {types.map((t) => (
                <ListItemButton
                  key={t.id}
                  selected={t.value === item.type}
                  disabled={converting || t.value === item.type}
                  onClick={() => void handleConvert(t)}
                >
                  <ListItemText primary={t.value} secondary={t.value === item.type ? 'current type' : undefined} />
                </ListItemButton>
              ))}
            </List>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setConvertOpen(false)} disabled={converting}>Cancel</Button>
        </DialogActions>
      </Dialog>
    </div>
  );
}
