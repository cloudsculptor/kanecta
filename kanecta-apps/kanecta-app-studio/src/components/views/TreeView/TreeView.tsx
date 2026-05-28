import { useCallback, useEffect, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { IconButton, Tooltip } from '@mui/material';
import HomeIcon from '@mui/icons-material/Home';
import StarIcon from '@mui/icons-material/Star';
import StarBorderIcon from '@mui/icons-material/StarBorder';
import FingerprintIcon from '@mui/icons-material/Fingerprint';
import LinkIcon from '@mui/icons-material/Link';
import { TreeNode } from './TreeNode';
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
  onToggle: (id: string) => void;
  onFocus: (item: KanectaItem) => void;
  onZoom: (item: KanectaItem) => void;
  onAddSibling: (item: KanectaItem) => void;
  onAddChild: (item: KanectaItem) => void;
  onDelete: (item: KanectaItem) => void;
  onEdit: (item: KanectaItem, value: string) => Promise<void>;
  onIndent: (item: KanectaItem) => void;
  onOutdent: (item: KanectaItem) => void;
  onNavigateToId: (id: string) => void;
  onExpandToDepth: (item: KanectaItem, depth: number | 'all') => void;
  onRecordClipboard: (item: KanectaItem, type: string, typeId: string) => void;
  onRecordViewed: (item: KanectaItem, type: string, typeId: string) => void;
}

function TreeBranch({
  parentId,
  workspaceId,
  expandedIds,
  focusedId,
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
          onToggle={() => onToggle(item.id)}
          onFocus={() => onFocus(item)}
          onZoom={() => onZoom(item)}
          onNavigateToId={onNavigateToId}
          onAddSibling={() => onAddSibling(item)}
          onAddChild={() => onAddChild(item)}
          onDelete={() => onDelete(item)}
          onEdit={(value) => onEdit(item, value)}
          onIndent={() => onIndent(item)}
          onOutdent={() => onOutdent(item)}
          onExpandToDepth={(depth) => onExpandToDepth(item, depth)}
          onRecordClipboard={(type, typeId) => onRecordClipboard(item, type, typeId)}
          onRecordViewed={(type, typeId) => onRecordViewed(item, type, typeId)}
        >
          {expandedIds.has(item.id) && (
            <TreeBranch
              parentId={item.id}
              workspaceId={workspaceId}
              expandedIds={expandedIds}
              focusedId={focusedId}
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
            />
          )}
        </TreeNode>
      ))}
    </>
  );
}

export function TreeView({ panelId, zoomedItemId }: TreeViewProps) {
  const { getApi, activeWorkspaceId } = useWorkspaceStore();
  const { setFocusedItem, focusedItemId } = useUiStore();
  const qc = useQueryClient();
  const api = getApi();

  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());
  const [zoomStack, setZoomStack] = useState<BreadcrumbItem[]>([]);
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

  const invalidate = useCallback(
    (parentId?: string | null) => {
      void qc.invalidateQueries({ queryKey: ['tree-children', parentId ?? null] });
    },
    [qc],
  );

  const createMutation = useMutation({
    mutationFn: (payload: { value: string; parentId?: string }) =>
      api.items.create({ value: payload.value, type: 'text', parentId: payload.parentId }),
    onSuccess: (_, vars) => invalidate(vars.parentId ?? null),
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, value }: { id: string; value: string }) =>
      api.items.update(id, { value }),
    onSuccess: (_data, vars) => {
      void qc.invalidateQueries({ queryKey: ['item', vars.id] });
    },
  });

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
    (item: KanectaItem) => setFocusedItem(item.id),
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

  const handleIndent = useCallback(
    (_item: KanectaItem) => {
      // indent: move under previous sibling — complex; placeholder for Phase 2
    },
    [],
  );

  const handleOutdent = useCallback(
    (_item: KanectaItem) => {
      // outdent: move up to grandparent — complex; placeholder for Phase 2
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
  };

  return (
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
                <FingerprintIcon sx={{ fontSize: 16 }} />
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
        {rootId === null
          ? (dataRoot?.value ?? 'Home')
          : breadcrumb[breadcrumb.length - 1].label}
      </div>

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

      </div>
    </div>
  );
}
