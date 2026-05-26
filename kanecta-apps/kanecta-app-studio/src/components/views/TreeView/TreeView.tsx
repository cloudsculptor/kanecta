import { useCallback, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import HomeIcon from '@mui/icons-material/Home';
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
          onAddSibling={() => onAddSibling(item)}
          onAddChild={() => onAddChild(item)}
          onDelete={() => onDelete(item)}
          onEdit={(value) => onEdit(item, value)}
          onIndent={() => onIndent(item)}
          onOutdent={() => onOutdent(item)}
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

  const { data: rootItems = [], isLoading, error } = useQuery({
    queryKey: ['tree-children', rootId, activeWorkspaceId],
    queryFn: () => (rootId ? api.items.children(rootId) : api.items.list()),
  });

  const invalidate = useCallback(
    (parentId?: string | null) => {
      void qc.invalidateQueries({ queryKey: ['tree-children', parentId ?? null] });
    },
    [qc],
  );

  const createMutation = useMutation({
    mutationFn: (payload: { value: string; parentId?: string }) =>
      api.items.create({ value: payload.value, type: 'note', parentId: payload.parentId }),
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
  };

  return (
    <div className="TreeView" data-testid={`tree-view-${panelId}`}>
      <div className="TreeView-breadcrumb">
        <Breadcrumb
          items={breadcrumb}
          onNavigate={(id) => {
            if (id === 'root') setZoomStack([]);
            else handleBreadcrumbNav(id);
          }}
        />
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
