import { useCallback, useEffect, useRef, useState } from 'react';
import type { ViewMeta } from '../../../lib/viewMeta';
import { useViewLocation } from '../../../context/LocationContext';

export const TreeViewMeta: ViewMeta = {
  uuid: 'b3a2c1d0-e4f5-4a6b-9c7d-8e0f1a2b3c4d',
  name: 'tree',
  label: 'Tree',
  icon: 'AccountTree',
};
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { IconButton, Tooltip, Dialog, DialogTitle, DialogContent, DialogContentText, DialogActions, Button } from '@mui/material';
import HomeIcon from '@mui/icons-material/Home';
import StarIcon from '@mui/icons-material/Star';
import StarBorderIcon from '@mui/icons-material/StarBorder';
import LinkIcon from '@mui/icons-material/Link';
import ContentCopyIcon from '@mui/icons-material/ContentCopy';
import DifferenceOutlinedIcon from '@mui/icons-material/DifferenceOutlined';
import CategoryIcon from '@mui/icons-material/Category';
import DataObjectIcon from '@mui/icons-material/DataObject';
import FileCopyOutlinedIcon from '@mui/icons-material/FileCopyOutlined';
import LooksTwoIcon from '@mui/icons-material/LooksTwo';
import Looks3Icon from '@mui/icons-material/Looks3';
import Looks4Icon from '@mui/icons-material/Looks4';
import Looks5Icon from '@mui/icons-material/Looks5';
import AddBoxIcon from '@mui/icons-material/AddBox';
import AddIcon from '@mui/icons-material/Add';
import DeleteIcon from '@mui/icons-material/Delete';
import EditIcon from '@mui/icons-material/Edit';
import CheckIcon from '@mui/icons-material/Check';
import CloseIcon from '@mui/icons-material/Close';
import { TreeNode } from './TreeNode';
import { CopyAsDialog } from './CopyAsDialog';
import { Breadcrumb } from '../../shared/Breadcrumb';
import type { BreadcrumbItem } from '../../shared/Breadcrumb';
import type { KanectaItem } from '../../../types/kanecta';
import { useWorkspaceStore } from '../../../store/workspace';
import { useUiStore } from '../../../store/ui';
import './TreeView.scss';

interface TreeViewProps {
  panelId: string;
  zoomedItemId?: string;
}

function useTreeData(parentId: string | null, workspaceId?: string) {
  const { getApi } = useWorkspaceStore();
  const api = getApi(workspaceId);
  return useQuery({
    queryKey: ['tree-children', parentId, workspaceId],
    queryFn: () => (parentId ? api.items.children(parentId) : api.items.list()),
  });
}

interface TreeBranchProps {
  parentId: string | null;
  workspaceId?: string;
  expandedIds: Set<string>;
  focusedId: string | null;
  focusNewItemId: string | null;
  onClearFocusNewItem: () => void;
  onToggle: (id: string) => void;
  onFocus: (item: KanectaItem) => void;
  onZoom: (item: KanectaItem) => void;
  onAddSibling: (item: KanectaItem) => void;
  onAddChild: (item: KanectaItem) => void;
  onDelete: (item: KanectaItem) => void;
  onEdit: (item: KanectaItem, value: string) => Promise<void>;
  onIndent: (item: KanectaItem, prevSibling: KanectaItem | null) => void;
  onOutdent: (item: KanectaItem) => void;
  onNavigateToId: (id: string) => void;
  onExpandToDepth: (item: KanectaItem, depth: number | 'all') => void;
  onRecordClipboard: (item: KanectaItem, type: string, typeId: string) => void;
  onRecordViewed: (item: KanectaItem, type: string, typeId: string) => void;
  onCopyObject: (item: KanectaItem) => Promise<void>;
  onCopyAs: (item: KanectaItem) => void;
}

function TreeBranch({
  parentId,
  workspaceId,
  expandedIds,
  focusedId,
  focusNewItemId,
  onClearFocusNewItem,
  onToggle,
  onFocus,
  onZoom,
  onAddSibling,
  onAddChild,
  onDelete,
  onEdit,
  onIndent,
  onOutdent,
  onNavigateToId,
  onExpandToDepth,
  onRecordClipboard,
  onRecordViewed,
  onCopyObject,
  onCopyAs,
}: TreeBranchProps) {
  const { data: items = [], isLoading, error } = useTreeData(parentId, workspaceId);

  if (isLoading) return <div style={{ padding: '4px 8px', fontSize: '0.8rem', color: 'var(--color-text-muted)' }}>Loading…</div>;
  if (error) return <div style={{ padding: '4px 8px', fontSize: '0.8rem', color: '#c62828' }}>Error loading items</div>;

  return (
    <>
      {items.map((item) => (
        <TreeNode
          key={item.id}
          item={item}
          isExpanded={expandedIds.has(item.id)}
          hasChildren={(item.childCount ?? 0) > 0 || expandedIds.has(item.id)}
          isFocused={focusedId === item.id}
          autoFocusEdit={focusNewItemId === item.id}
          onAutoFocused={onClearFocusNewItem}
          onToggle={() => onToggle(item.id)}
          onFocus={() => onFocus(item)}
          onZoom={() => onZoom(item)}
          onNavigateToId={onNavigateToId}
          onAddSibling={() => onAddSibling(item)}
          onAddChild={() => onAddChild(item)}
          onDelete={() => onDelete(item)}
          onEdit={(value) => onEdit(item, value)}
          onIndent={() => { const idx = items.findIndex((i) => i.id === item.id); onIndent(item, idx > 0 ? items[idx - 1] : null); }}
          onOutdent={() => onOutdent(item)}
          onExpandToDepth={(depth) => onExpandToDepth(item, depth)}
          onRecordClipboard={(type, typeId) => onRecordClipboard(item, type, typeId)}
          onRecordViewed={(type, typeId) => onRecordViewed(item, type, typeId)}
          onCopyObject={item._hasObject ? () => onCopyObject(item) : undefined}
          onCopyAs={() => onCopyAs(item)}
        >
          {expandedIds.has(item.id) && (
            <TreeBranch
              parentId={item.id}
              workspaceId={workspaceId}
              expandedIds={expandedIds}
              focusedId={focusedId}
              focusNewItemId={focusNewItemId}
              onClearFocusNewItem={onClearFocusNewItem}
              onToggle={onToggle}
              onFocus={onFocus}
              onZoom={onZoom}
              onAddSibling={onAddSibling}
              onAddChild={onAddChild}
              onDelete={onDelete}
              onEdit={onEdit}
              onIndent={onIndent}
              onOutdent={onOutdent}
              onNavigateToId={onNavigateToId}
              onExpandToDepth={onExpandToDepth}
              onRecordClipboard={onRecordClipboard}
              onRecordViewed={onRecordViewed}
              onCopyObject={onCopyObject}
              onCopyAs={onCopyAs}
            />
          )}
        </TreeNode>
      ))}
    </>
  );
}

export function TreeView({ panelId, zoomedItemId }: TreeViewProps) {
  useViewLocation(TreeViewMeta.uuid);
  const { getApi, activeWorkspaceId } = useWorkspaceStore();
  const { setFocusedItem, focusedItemId } = useUiStore();
  const qc = useQueryClient();
  const api = getApi();

  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());
  const [zoomStack, setZoomStack] = useState<BreadcrumbItem[]>([]);
  const [copyAsItem, setCopyAsItem] = useState<KanectaItem | null>(null);
  const [confirmDeleteRoot, setConfirmDeleteRoot] = useState(false);
  const [focusNewItemId, setFocusNewItemId] = useState<string | null>(null);
  const rootId = zoomedItemId ?? zoomStack[zoomStack.length - 1]?.id ?? null;

  const { data: starredList = [] } = useQuery({
    queryKey: ['starred'],
    queryFn: () => api.starred.list(),
    refetchInterval: 10_000,
  });
  const isStarred = rootId ? starredList.some((e) => e.id === rootId) : false;
  const currentLabel = zoomStack[zoomStack.length - 1]?.label ?? '';

  const handleStar = useCallback(async () => {
    if (!rootId) return;
    if (isStarred) {
      await api.starred.remove(rootId);
    } else {
      const item = await api.items.get(rootId);
      await api.starred.add(rootId, currentLabel, item.type, item.typeId ?? '');
    }
    void qc.invalidateQueries({ queryKey: ['starred'] });
  }, [rootId, isStarred, currentLabel, api, qc]);

  const handleCopyId = useCallback(() => {
    if (!rootId) return;
    void navigator.clipboard.writeText(rootId);
    void api.breadcrumb.addClipboard(rootId, currentLabel, '', '');
  }, [rootId, currentLabel, api]);

  const handleCopyUrl = useCallback(() => {
    void navigator.clipboard.writeText(window.location.href);
  }, []);

  // Restore zoom state from hash on mount
  useEffect(() => {
    const match = window.location.hash.match(/^#\/tree\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i);
    if (!match) return;
    const id = match[1];
    void getApi().items.get(id)
      .then((item) => setZoomStack([{ id, label: item.value }]))
      .catch(() => {});
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Sync rootId → URL hash
  useEffect(() => {
    const hash = rootId ? `/tree/${rootId}` : '';
    history.replaceState(null, '', `${window.location.pathname}${window.location.search}${hash ? `#${hash}` : ''}`);
  }, [rootId]);

  const { data: rootItems = [], isLoading, error } = useQuery({
    queryKey: ['tree-children', rootId, activeWorkspaceId],
    queryFn: () => (rootId ? api.items.children(rootId) : api.items.list()),
  });

  const { data: dataRoot } = useQuery({
    queryKey: ['data-root', activeWorkspaceId],
    queryFn: () => api.items.root(),
    enabled: rootId === null,
  });

  const { data: rootItem } = useQuery({
    queryKey: ['item', rootId, activeWorkspaceId],
    queryFn: () => api.items.get(rootId!),
    enabled: rootId !== null,
  });

  const invalidate = useCallback(
    (parentId?: string | null) => {
      void qc.invalidateQueries({ queryKey: ['tree-children', parentId ?? null] });
    },
    [qc],
  );

  const createMutation = useMutation({
    mutationFn: (payload: { value: string; parentId?: string }) =>
      api.items.create({ value: payload.value, type: 'text', parentId: payload.parentId }),
    onMutate: async (vars) => {
      const key = ['tree-children', vars.parentId ?? null, activeWorkspaceId];
      await qc.cancelQueries({ queryKey: key });
      const previous = qc.getQueryData(key);
      const tempId = `temp-${Date.now()}`;
      const tempItem: KanectaItem = {
        id: tempId,
        value: vars.value,
        type: 'text',
        confidence: null,
        parentId: vars.parentId,
        sortOrder: 0,
        tags: [],
        createdAt: null,
        modifiedAt: null,
        childCount: 0,
      };
      qc.setQueryData(key, (old: KanectaItem[] = []) => [...old, tempItem]);
      return { previous, key, tempId };
    },
    onSuccess: (newItem, vars, context) => {
      const key = ['tree-children', vars.parentId ?? null, activeWorkspaceId];
      qc.setQueryData(key, (old: KanectaItem[] = []) =>
        old.map((item) => (item.id === context?.tempId ? newItem : item))
      );
      setFocusNewItemId(newItem.id);
    },
    onError: (_err, _vars, context) => {
      if (context?.key) qc.setQueryData(context.key, context.previous);
    },
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, value }: { id: string; value: string }) =>
      api.items.update(id, { value }),
    onSuccess: (_data, vars) => {
      void qc.invalidateQueries({ queryKey: ['item', vars.id] });
    },
  });

  const [isEditingRoot, setIsEditingRoot] = useState(false);
  const [editRootValue, setEditRootValue] = useState('');
  const rootEditRef = useRef<HTMLInputElement>(null);

  const startRootEdit = useCallback(() => {
    setEditRootValue(dataRoot?.value ?? '');
    setIsEditingRoot(true);
  }, [dataRoot]);

  const cancelRootEdit = useCallback(() => {
    setIsEditingRoot(false);
    setEditRootValue('');
  }, []);

  const saveRootEdit = useCallback(async () => {
    if (!dataRoot || !editRootValue.trim()) { cancelRootEdit(); return; }
    await updateMutation.mutateAsync({ id: dataRoot.id, value: editRootValue.trim() });
    void qc.invalidateQueries({ queryKey: ['data-root', activeWorkspaceId] });
    setIsEditingRoot(false);
  }, [dataRoot, editRootValue, updateMutation, qc, activeWorkspaceId, cancelRootEdit]);

  const deleteMutation = useMutation({
    mutationFn: ({ id }: { id: string; parentId: string | null }) =>
      api.items.delete(id, true),
    onSuccess: (_, vars) => invalidate(vars.parentId),
  });

  const handleToggle = useCallback((id: string) => {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const handleZoom = useCallback((item: KanectaItem) => {
    setZoomStack((prev) => [...prev, { id: item.id, label: item.value }]);
    setExpandedIds(new Set());
  }, []);

  const handleNavigateToId = useCallback(async (id: string) => {
    const item = await api.items.get(id);
    setZoomStack((prev) => [...prev, { id, label: item.value }]);
    setExpandedIds(new Set());
  }, [api]);

  const handleBreadcrumbNav = useCallback(
    (id: string) => {
      setZoomStack((prev) => {
        const idx = prev.findIndex((b) => b.id === id);
        return idx >= 0 ? prev.slice(0, idx + 1) : prev;
      });
    },
    [],
  );

  const handleFocus = useCallback(
    (item: KanectaItem) => { setFocusedItem(item.id); },
    [setFocusedItem],
  );

  const handleEdit = useCallback(
    async (item: KanectaItem, value: string) => {
      await updateMutation.mutateAsync({ id: item.id, value });
    },
    [updateMutation],
  );

  const handleAddChild = useCallback(
    (item: KanectaItem) => {
      setExpandedIds((prev) => new Set([...prev, item.id]));
      createMutation.mutate({ value: '', parentId: item.id });
    },
    [createMutation],
  );

  const handleAddSibling = useCallback(
    (item: KanectaItem) => {
      createMutation.mutate({ value: '', parentId: item.parentId ?? undefined });
    },
    [createMutation],
  );

  const handleDelete = useCallback(
    (item: KanectaItem) => {
      deleteMutation.mutate({ id: item.id, parentId: item.parentId ?? null });
    },
    [deleteMutation],
  );

  const moveMutation = useMutation({
    mutationFn: ({ id, newParentId }: { id: string; newParentId: string; oldParentId: string | null }) =>
      api.items.update(id, { parentId: newParentId }),
    onSuccess: (_, vars) => {
      invalidate(vars.oldParentId);
      invalidate(vars.newParentId);
    },
  });

  const handleIndent = useCallback(
    (item: KanectaItem, prevSibling: KanectaItem | null) => {
      if (!prevSibling) return;
      setExpandedIds((prev) => new Set([...prev, prevSibling.id]));
      moveMutation.mutate({ id: item.id, newParentId: prevSibling.id, oldParentId: item.parentId ?? null });
    },
    [moveMutation, setExpandedIds],
  );

  const handleOutdent = useCallback(
    (_item: KanectaItem) => {
      // outdent: move up to grandparent — placeholder for Phase 2
    },
    [],
  );

  const handleRecordClipboard = useCallback(
    (item: KanectaItem, type: string, typeId: string) => {
      void api.breadcrumb.addClipboard(item.id, item.value, type, typeId);
    },
    [api],
  );

  const handleRecordViewed = useCallback(
    (item: KanectaItem, type: string, typeId: string) => {
      void api.breadcrumb.addViewed(item.id, item.value, type, typeId);
    },
    [api],
  );

  const handleCopyObject = useCallback(
    async (item: KanectaItem) => {
      const obj = await api.items.getObject(item.id);
      await navigator.clipboard.writeText(JSON.stringify(obj, null, 2));
    },
    [api],
  );

  const handleCopyAs = useCallback((item: KanectaItem) => {
    setCopyAsItem(item);
  }, []);

  const fetchTreeForDialog = useCallback(
    (id: string) => api.items.tree(id),
    [api],
  );

  const handleExpandToDepth = useCallback(
    async (item: KanectaItem, depth: number | 'all') => {
      const maxDepth = depth === 'all' ? undefined : depth;
      const entries = await api.items.tree(item.id, maxDepth);
      const ids = entries
        .filter((e) => maxDepth == null || e.depth < maxDepth)
        .map((e) => e.item.id);
      setExpandedIds((prev) => new Set([...prev, ...ids]));
    },
    [api],
  );

  const breadcrumb: BreadcrumbItem[] = [
    { id: 'root', label: 'Home', icon: <HomeIcon className="Breadcrumb-home-icon" /> },
    ...zoomStack,
  ];

  const branchProps = {
    workspaceId: activeWorkspaceId,
    expandedIds,
    focusedId: focusedItemId,
    focusNewItemId,
    onClearFocusNewItem: () => setFocusNewItemId(null),
    onToggle: handleToggle,
    onFocus: handleFocus,
    onZoom: handleZoom,
    onAddSibling: handleAddSibling,
    onAddChild: handleAddChild,
    onDelete: handleDelete,
    onEdit: handleEdit,
    onIndent: handleIndent,
    onOutdent: handleOutdent,
    onNavigateToId: handleNavigateToId,
    onExpandToDepth: handleExpandToDepth,
    onRecordClipboard: handleRecordClipboard,
    onRecordViewed: handleRecordViewed,
    onCopyObject: handleCopyObject,
    onCopyAs: handleCopyAs,
  };

  return (
    <>
    <div className="TreeView" data-testid={`tree-view-${panelId}`}>
      {zoomStack.length > 0 && (
        <div className="TreeView-breadcrumb">
          <Breadcrumb
            items={breadcrumb}
            onNavigate={(id) => {
              if (id === 'root') setZoomStack([]);
              else handleBreadcrumbNav(id);
            }}
          />
          <div className="TreeView-breadcrumb-actions">
            <Tooltip title={isStarred ? 'Unstar' : 'Star'}>
              <IconButton size="small" className={`TreeView-breadcrumb-btn${isStarred ? ' TreeView-breadcrumb-btn--starred' : ''}`} onClick={() => void handleStar()}>
                {isStarred ? <StarIcon sx={{ fontSize: 16 }} /> : <StarBorderIcon sx={{ fontSize: 16 }} />}
              </IconButton>
            </Tooltip>
            <Tooltip title="Copy ID">
              <IconButton size="small" className="TreeView-breadcrumb-btn" onClick={handleCopyId}>
                <ContentCopyIcon sx={{ fontSize: 16 }} />
              </IconButton>
            </Tooltip>
            <Tooltip title="Copy URL">
              <IconButton size="small" className="TreeView-breadcrumb-btn" onClick={handleCopyUrl}>
                <LinkIcon sx={{ fontSize: 16 }} />
              </IconButton>
            </Tooltip>
          </div>
        </div>
      )}

      <div className="TreeView-heading">
        {rootId === null ? (
          isEditingRoot ? (
            <>
              <input
                ref={rootEditRef}
                className="TreeView-heading-input"
                value={editRootValue}
                autoFocus
                onChange={e => setEditRootValue(e.target.value)}
                onKeyDown={e => {
                  if (e.key === 'Enter' || e.key === 'Tab') { e.preventDefault(); void saveRootEdit(); }
                  if (e.key === 'Escape') cancelRootEdit();
                }}
              />
              <div className="TreeView-heading-actions TreeNode-actions" style={{ visibility: 'visible' }}>
                <Tooltip title="Save">
                  <IconButton size="small" onClick={() => void saveRootEdit()}>
                    <CheckIcon sx={{ fontSize: 16 }} />
                  </IconButton>
                </Tooltip>
                <Tooltip title="Cancel">
                  <IconButton size="small" onClick={cancelRootEdit}>
                    <CloseIcon sx={{ fontSize: 16 }} />
                  </IconButton>
                </Tooltip>
              </div>
            </>
          ) : (
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
              <span>{dataRoot?.value ?? 'Home'}</span>
              {dataRoot && (
                <div className="TreeView-heading-actions TreeNode-actions">
                  <Tooltip title="Rename">
                    <IconButton size="small" onClick={startRootEdit} sx={{ padding: '2px', marginTop: '-4px' }}>
                      <EditIcon sx={{ width: '24px !important', height: '24px !important', color: '#999' }} />
                    </IconButton>
                  </Tooltip>
                </div>
              )}
            </div>
          )
        ) : (
          <span className="TreeView-heading-label">
            {breadcrumb[breadcrumb.length - 1].label}
          </span>
        )}
        {rootId !== null && rootItem && (
          <div className="TreeView-heading-actions TreeNode-actions">
            <Tooltip title="Copy ID">
              <IconButton size="small" onClick={() => { void navigator.clipboard.writeText(rootItem.id); void api.breadcrumb.addClipboard(rootItem.id, rootItem.value, rootItem.type, rootItem.typeId ?? ''); }}>
                <ContentCopyIcon sx={{ fontSize: '18px', width: '18px', height: '18px' }} />
              </IconButton>
            </Tooltip>
            <Tooltip title="Copy value">
              <IconButton size="small" onClick={() => { void navigator.clipboard.writeText(rootItem.value); }}>
                <DifferenceOutlinedIcon sx={{ fontSize: '18px', width: '18px', height: '18px' }} />
              </IconButton>
            </Tooltip>
            {rootItem.typeId && (
              <Tooltip title="Copy type ID">
                <IconButton size="small" onClick={() => { void navigator.clipboard.writeText(rootItem.typeId!); }}>
                  <CategoryIcon sx={{ fontSize: '18px', width: '18px', height: '18px' }} />
                </IconButton>
              </Tooltip>
            )}
            {rootItem._hasObject && (
              <Tooltip title="Copy object JSON">
                <IconButton size="small" onClick={() => { void handleCopyObject(rootItem); }}>
                  <DataObjectIcon sx={{ fontSize: '18px', width: '18px', height: '18px' }} />
                </IconButton>
              </Tooltip>
            )}
            <Tooltip title="Copy as">
              <IconButton size="small" onClick={() => handleCopyAs(rootItem)}>
                <FileCopyOutlinedIcon sx={{ fontSize: '18px', width: '18px', height: '18px' }} />
              </IconButton>
            </Tooltip>
            {([
              { depth: 2, Icon: LooksTwoIcon, label: 'Expand 2 levels' },
              { depth: 3, Icon: Looks3Icon,   label: 'Expand 3 levels' },
              { depth: 4, Icon: Looks4Icon,   label: 'Expand 4 levels' },
              { depth: 5, Icon: Looks5Icon,   label: 'Expand 5 levels' },
              { depth: 'all' as const, Icon: AddBoxIcon, label: 'Expand all' },
            ] as const).map(({ depth, Icon, label }) => (
              <Tooltip key={String(depth)} title={label}>
                <IconButton size="small" onClick={() => void handleExpandToDepth(rootItem, depth)}>
                  <Icon sx={{ fontSize: '18px', width: '18px', height: '18px' }} />
                </IconButton>
              </Tooltip>
            ))}
            <Tooltip title="Add child">
              <IconButton size="small" onClick={() => handleAddChild(rootItem)}>
                <AddIcon sx={{ fontSize: '18px', width: '18px', height: '18px' }} />
              </IconButton>
            </Tooltip>
            <Tooltip title="Delete">
              <IconButton size="small" onClick={() => setConfirmDeleteRoot(true)}>
                <DeleteIcon sx={{ fontSize: '18px', width: '18px', height: '18px' }} />
              </IconButton>
            </Tooltip>
          </div>
        )}
      </div>

      <Dialog open={confirmDeleteRoot} onClose={() => setConfirmDeleteRoot(false)}>
        <DialogTitle>Delete "{rootItem?.value}"?</DialogTitle>
        <DialogContent>
          <DialogContentText>
            This will also delete all of its descendants. This cannot be undone.
          </DialogContentText>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setConfirmDeleteRoot(false)}>Cancel</Button>
          <Button color="error" onClick={() => { setConfirmDeleteRoot(false); if (rootItem) handleDelete(rootItem); }}>Delete</Button>
        </DialogActions>
      </Dialog>

      <div className="TreeView-content">
        {isLoading && <div className="TreeView-loading">Loading…</div>}
        {error && <div className="TreeView-error">Failed to load items</div>}
        {!isLoading && !error && rootItems.length === 0 && (
          <div className="TreeView-empty">
            <span>No items yet</span>
          </div>
        )}

        {!isLoading && !error && (
          <TreeBranch parentId={rootId} {...branchProps} />
        )}

        <div className="TreeNode">
          <div
            className="TreeNode-row"
            onClick={() => createMutation.mutate({ value: '', parentId: rootId ?? undefined })}
          >
            <button className="TreeNode-toggle TreeNode-toggle--leaf" tabIndex={-1} aria-hidden="true" />
            <AddIcon className="TreeNode-bullet" />
          </div>
        </div>
      </div>
    </div>

    <CopyAsDialog
      item={copyAsItem}
      open={copyAsItem !== null}
      onClose={() => setCopyAsItem(null)}
      fetchTree={fetchTreeForDialog}
    />
    </>
  );
}
