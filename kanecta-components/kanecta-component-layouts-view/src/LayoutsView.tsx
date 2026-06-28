import {
  useState, useRef, useCallback, createContext, useContext,
  type ReactNode, type KeyboardEvent, type MouseEvent as RMouseEvent,
} from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import AddIcon from '@mui/icons-material/Add';
import CloseIcon from '@mui/icons-material/Close';
import SplitscreenIcon from '@mui/icons-material/Splitscreen';
import type { PaneNode, LeafNode, SplitNode, LayoutTab, LayoutData, AvailableView } from './types';
import './LayoutsView.css';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function uid() { return crypto.randomUUID(); }

export interface LayoutsViewProps {
  onFetchLayout: () => Promise<LayoutData>;
  onSaveLayout: (data: LayoutData) => Promise<unknown>;
  onResolveAlias?: (alias: string) => Promise<string | null>;
  renderView: (
    viewType: string,
    paneId: string,
    itemId: string | null,
    onSetItemId: (id: string | null) => void,
  ) => ReactNode;
  availableViews: AvailableView[];
}

interface LayoutCtxValue {
  renderView: LayoutsViewProps['renderView'];
  availableViews: AvailableView[];
  onResolveAlias?: (alias: string) => Promise<string | null>;
}

const LayoutCtx = createContext<LayoutCtxValue>({
  renderView: () => null,
  availableViews: [],
});

function ViewPicker({ onPick }: { onPick: (viewType: string) => void }) {
  const { availableViews } = useContext(LayoutCtx);
  return (
    <div className="LayoutsView-picker">
      {availableViews.map(({ id, label, icon }) => (
        <button key={id} className="LayoutsView-picker-item" onClick={() => onPick(id)}>
          {icon}
          <span>{label}</span>
        </button>
      ))}
    </div>
  );
}

function PaneItemInput({
  itemId,
  onSetItemId,
}: {
  itemId: string | null;
  onSetItemId: (id: string | null) => void;
}) {
  const [value, setValue] = useState('');
  const { onResolveAlias } = useContext(LayoutCtx);

  const handleKeyDown = async (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key !== 'Enter') return;
    const input = value.trim();
    if (!input) { onSetItemId(null); setValue(''); return; }
    if (UUID_RE.test(input)) { onSetItemId(input); setValue(''); return; }
    if (onResolveAlias) {
      try {
        const id = await onResolveAlias(input.toLowerCase());
        if (id) { onSetItemId(id); setValue(''); }
      } catch { /* alias not found */ }
    }
  };

  return (
    <div className="LayoutsView-item-input-wrap">
      <input
        className="LayoutsView-item-input"
        type="text"
        placeholder={itemId ?? 'UUID or alias…'}
        value={value}
        onChange={e => setValue(e.target.value)}
        onKeyDown={e => void handleKeyDown(e)}
      />
    </div>
  );
}

function LeafPane({
  node,
  onUpdate,
  onSplitH,
  onSplitV,
  onClose,
  canClose,
}: {
  node: LeafNode;
  onUpdate: (patch: Partial<LeafNode>) => void;
  onSplitH: () => void;
  onSplitV: () => void;
  onClose: () => void;
  canClose: boolean;
}) {
  const { renderView, availableViews } = useContext(LayoutCtx);
  const setItemId = useCallback((id: string | null) => onUpdate({ itemId: id }), [onUpdate]);
  const viewLabel = availableViews.find(v => v.id === node.viewType)?.label ?? node.viewType;
  const viewIcon = availableViews.find(v => v.id === node.viewType)?.icon ?? null;

  return (
    <div className="LayoutsView-leaf">
      <div className="LayoutsView-leaf-toolbar">
        <span className="LayoutsView-leaf-view-label">
          {node.viewType ? viewIcon : null}
          <span>{node.viewType ? viewLabel : 'Pick a view'}</span>
        </span>
        {node.viewType && (
          <PaneItemInput itemId={node.itemId} onSetItemId={setItemId} />
        )}
        <div className="LayoutsView-leaf-actions">
          <button className="LayoutsView-leaf-btn" title="Split horizontal" onClick={onSplitH}>
            <SplitscreenIcon style={{ transform: 'rotate(90deg)', fontSize: 16 }} />
          </button>
          <button className="LayoutsView-leaf-btn" title="Split vertical" onClick={onSplitV}>
            <SplitscreenIcon style={{ fontSize: 16 }} />
          </button>
          {canClose && (
            <button className="LayoutsView-leaf-btn LayoutsView-leaf-btn--close" title="Close pane" onClick={onClose}>
              <CloseIcon style={{ fontSize: 16 }} />
            </button>
          )}
        </div>
      </div>
      <div className="LayoutsView-leaf-content">
        {node.viewType
          ? renderView(node.viewType, node.id, node.itemId, setItemId)
          : <ViewPicker onPick={viewType => onUpdate({ viewType })} />}
      </div>
    </div>
  );
}

function SplitPane({
  node,
  onUpdate,
  onReplace,
  isRoot,
}: {
  node: SplitNode;
  onUpdate: (updated: SplitNode) => void;
  onReplace: (replacement: PaneNode) => void;
  isRoot: boolean;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const dragging = useRef(false);

  const handleDragStart = (e: RMouseEvent) => {
    e.preventDefault();
    dragging.current = true;

    const onMove = (me: globalThis.MouseEvent) => {
      if (!dragging.current || !containerRef.current) return;
      const rect = containerRef.current.getBoundingClientRect();
      let ratio: number;
      if (node.direction === 'horizontal') {
        ratio = (me.clientX - rect.left) / rect.width;
      } else {
        ratio = (me.clientY - rect.top) / rect.height;
      }
      ratio = Math.max(0.1, Math.min(0.9, ratio));
      onUpdate({ ...node, sizes: [ratio * 100, (1 - ratio) * 100] });
    };

    const onUp = () => {
      dragging.current = false;
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };

    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  };

  const updateChild = (index: 0 | 1, updated: PaneNode) => {
    const children: [PaneNode, PaneNode] = [...node.children] as [PaneNode, PaneNode];
    children[index] = updated;
    onUpdate({ ...node, children });
  };

  const removeChild = (index: 0 | 1) => {
    onReplace(node.children[index === 0 ? 1 : 0]);
  };

  const splitLeaf = (index: 0 | 1, direction: 'horizontal' | 'vertical') => {
    const target = node.children[index];
    const newLeaf: LeafNode = { type: 'leaf', id: uid(), viewType: null, itemId: null };
    const newSplit: SplitNode = { type: 'split', id: uid(), direction, sizes: [50, 50], children: [target, newLeaf] };
    updateChild(index, newSplit);
  };

  const renderNode = (child: PaneNode, index: 0 | 1): ReactNode => {
    if (child.type === 'leaf') {
      return (
        <LeafPane
          key={child.id}
          node={child}
          onUpdate={patch => updateChild(index, { ...child, ...patch })}
          onSplitH={() => splitLeaf(index, 'horizontal')}
          onSplitV={() => splitLeaf(index, 'vertical')}
          onClose={() => removeChild(index)}
          canClose={!isRoot || node.children.length > 1}
        />
      );
    }
    return (
      <SplitPane
        key={child.id}
        node={child}
        onUpdate={updated => updateChild(index, updated)}
        onReplace={replacement => updateChild(index, replacement)}
        isRoot={false}
      />
    );
  };

  return (
    <div
      ref={containerRef}
      className={`LayoutsView-split LayoutsView-split--${node.direction}`}
    >
      <div className="LayoutsView-split-child" style={{ flexBasis: `${node.sizes[0]}%` }}>
        {renderNode(node.children[0], 0)}
      </div>
      <div
        className={`LayoutsView-divider LayoutsView-divider--${node.direction}`}
        onMouseDown={handleDragStart}
      />
      <div className="LayoutsView-split-child" style={{ flexBasis: `${node.sizes[1]}%` }}>
        {renderNode(node.children[1], 1)}
      </div>
    </div>
  );
}

function RootPane({
  root,
  onUpdate,
}: {
  root: PaneNode;
  onUpdate: (updated: PaneNode) => void;
}) {
  const splitRoot = (direction: 'horizontal' | 'vertical') => {
    const newLeaf: LeafNode = { type: 'leaf', id: uid(), viewType: null, itemId: null };
    const newSplit: SplitNode = { type: 'split', id: uid(), direction, sizes: [50, 50], children: [root, newLeaf] };
    onUpdate(newSplit);
  };

  if (root.type === 'leaf') {
    return (
      <LeafPane
        node={root}
        onUpdate={patch => onUpdate({ ...root, ...patch })}
        onSplitH={() => splitRoot('horizontal')}
        onSplitV={() => splitRoot('vertical')}
        onClose={() => {}}
        canClose={false}
      />
    );
  }

  return (
    <SplitPane
      node={root}
      onUpdate={onUpdate}
      onReplace={onUpdate}
      isRoot={true}
    />
  );
}

function TabBar({
  tabs,
  activeTabId,
  onSelectTab,
  onRenameTab,
  onAddTab,
  onCloseTab,
}: {
  tabs: LayoutTab[];
  activeTabId: string;
  onSelectTab: (id: string) => void;
  onRenameTab: (id: string, label: string) => void;
  onAddTab: () => void;
  onCloseTab: (id: string) => void;
}) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editValue, setEditValue] = useState('');

  const startRename = (tab: LayoutTab) => {
    setEditingId(tab.id);
    setEditValue(tab.label);
  };

  const commitRename = () => {
    if (editingId && editValue.trim()) onRenameTab(editingId, editValue.trim());
    setEditingId(null);
  };

  return (
    <div className="LayoutsView-tabbar">
      {tabs.map(tab => (
        <div
          key={tab.id}
          className={`LayoutsView-tab${tab.id === activeTabId ? ' LayoutsView-tab--active' : ''}`}
          onClick={() => onSelectTab(tab.id)}
          onDoubleClick={() => startRename(tab)}
        >
          {editingId === tab.id ? (
            <input
              className="LayoutsView-tab-input"
              value={editValue}
              autoFocus
              onChange={e => setEditValue(e.target.value)}
              onBlur={commitRename}
              onKeyDown={e => { if (e.key === 'Enter') commitRename(); if (e.key === 'Escape') setEditingId(null); }}
              onClick={e => e.stopPropagation()}
            />
          ) : (
            <span className="LayoutsView-tab-label">{tab.label}</span>
          )}
          {tabs.length > 1 && (
            <button
              className="LayoutsView-tab-close"
              onClick={e => { e.stopPropagation(); onCloseTab(tab.id); }}
            >
              <CloseIcon style={{ fontSize: 12 }} />
            </button>
          )}
        </div>
      ))}
      <button className="LayoutsView-tab-add" onClick={onAddTab} title="New tab">
        <AddIcon style={{ fontSize: 16 }} />
      </button>
    </div>
  );
}

export function LayoutsView({
  onFetchLayout,
  onSaveLayout,
  onResolveAlias,
  renderView,
  availableViews,
}: LayoutsViewProps) {
  const qc = useQueryClient();
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [layout, setLayout] = useState<LayoutData | null>(null);

  useQuery({
    queryKey: ['layouts'],
    queryFn: async () => {
      const data = await onFetchLayout();
      setLayout(data);
      return data;
    },
    staleTime: Infinity,
  });

  const persist = useCallback((data: LayoutData) => {
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      void onSaveLayout(data).then(() => {
        void qc.invalidateQueries({ queryKey: ['layouts'] });
      });
    }, 500);
  }, [onSaveLayout, qc]);

  const update = useCallback((data: LayoutData) => {
    setLayout(data);
    persist(data);
  }, [persist]);

  if (!layout) return <div className="LayoutsView-loading">Loading…</div>;

  const activeTab = layout.tabs.find(t => t.id === layout.activeTabId) ?? layout.tabs[0];

  const updateRoot = (root: PaneNode) => {
    const tabs = layout.tabs.map(t => t.id === activeTab.id ? { ...t, root } : t);
    update({ ...layout, tabs });
  };

  const addTab = () => {
    const id = uid();
    const paneId = uid();
    const tab: LayoutTab = { id, label: `Tab ${layout.tabs.length + 1}`, root: { type: 'leaf', id: paneId, viewType: null, itemId: null } };
    update({ ...layout, tabs: [...layout.tabs, tab], activeTabId: id });
  };

  const closeTab = (id: string) => {
    const tabs = layout.tabs.filter(t => t.id !== id);
    const activeTabId = id === layout.activeTabId ? (tabs[0]?.id ?? '') : layout.activeTabId;
    update({ ...layout, tabs, activeTabId });
  };

  const renameTab = (id: string, label: string) => {
    const tabs = layout.tabs.map(t => t.id === id ? { ...t, label } : t);
    update({ ...layout, tabs });
  };

  return (
    <LayoutCtx.Provider value={{ renderView, availableViews, onResolveAlias }}>
      <div className="LayoutsView">
        <TabBar
          tabs={layout.tabs}
          activeTabId={layout.activeTabId}
          onSelectTab={id => update({ ...layout, activeTabId: id })}
          onRenameTab={renameTab}
          onAddTab={addTab}
          onCloseTab={closeTab}
        />
        <div className="LayoutsView-canvas">
          <RootPane key={activeTab.id} root={activeTab.root} onUpdate={updateRoot} />
        </div>
      </div>
    </LayoutCtx.Provider>
  );
}
