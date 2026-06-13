import {
  useState, useRef, useCallback, useContext,
  type ReactNode, type KeyboardEvent, type MouseEvent as RMouseEvent,
} from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import AccountTreeIcon from '@mui/icons-material/AccountTree';
import AutoAwesomeIcon from '@mui/icons-material/AutoAwesome';
import BubbleChartIcon from '@mui/icons-material/BubbleChart';
import ChecklistIcon from '@mui/icons-material/Checklist';
import DashboardCustomizeIcon from '@mui/icons-material/DashboardCustomize';
import DateRangeIcon from '@mui/icons-material/DateRange';
import FactCheckIcon from '@mui/icons-material/FactCheck';
import FlightIcon from '@mui/icons-material/Flight';
import FunctionsIcon from '@mui/icons-material/Functions';
import GridViewIcon from '@mui/icons-material/GridView';
import HistoryIcon from '@mui/icons-material/History';
import MergeTypeIcon from '@mui/icons-material/MergeType';
import PsychologyIcon from '@mui/icons-material/Psychology';
import SchemaIcon from '@mui/icons-material/Schema';
import SettingsIcon from '@mui/icons-material/Settings';
import StarIcon from '@mui/icons-material/Star';
import TableChartIcon from '@mui/icons-material/TableChart';
import ViewKanbanIcon from '@mui/icons-material/ViewKanban';
import ViewListIcon from '@mui/icons-material/ViewList';
import AddIcon from '@mui/icons-material/Add';
import CloseIcon from '@mui/icons-material/Close';
import SplitscreenIcon from '@mui/icons-material/Splitscreen';
import { LocationContext, useLocation } from '../../../context/LocationContext';
import { useWorkspaceStore } from '../../../store/workspace';
import { useUiStore } from '../../../store/ui';
import { TreeView } from '@kanecta/component-tree-view';
import { TableView } from '../TableView/TableView';
import { BoardView } from '../BoardView/BoardView';
import { GalleryView } from '../GalleryView/GalleryView';
import { ListView } from '../ListView/ListView';
import { CalendarView } from '../CalendarView/CalendarView';
import { GraphView } from '../GraphView/GraphView';
import { CombinatorView } from '../CombinatorView/CombinatorView';
import { MissionControl } from '../MissionControl/MissionControl';
import { QualityControlView } from '../QualityControlView/QualityControlView';
import { HistoryView } from '../HistoryView/HistoryView';
import { TypesView } from '../TemplatesView/TypesView';
import { StarredView } from '../StarredView/StarredView';
import { AIInstructionsView } from '../AIInstructionsView/AIInstructionsView';
import { ClaudeView } from '../ClaudeView/ClaudeView';
import { DiagramView } from '../DiagramView/DiagramView';
import { FunctionsView } from '../FunctionsView/FunctionsView';
import { TodoView } from '../TodoView/TodoView';
import type { PaneNode, LeafNode, SplitNode, LayoutTab, LayoutData } from './types';
import './LayoutsView.scss';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const VIEW_ICONS: Record<string, ReactNode> = {
  tree: <AccountTreeIcon />, types: <DashboardCustomizeIcon />,
  table: <TableChartIcon />, functions: <FunctionsIcon />,
  diagram: <SchemaIcon />, combinator: <MergeTypeIcon />,
  'ai-instructions': <PsychologyIcon />, graph: <BubbleChartIcon />,
  'quality-control': <FactCheckIcon />, claude: <AutoAwesomeIcon />,
  history: <HistoryIcon />, starred: <StarIcon />,
  list: <ViewListIcon />, board: <ViewKanbanIcon />,
  gallery: <GridViewIcon />, calendar: <DateRangeIcon />,
  'mission-control': <FlightIcon />, settings: <SettingsIcon />,
  todo: <ChecklistIcon />,
};

const VIEW_LABELS: Record<string, string> = {
  tree: 'Tree', types: 'Types', table: 'Table', functions: 'Functions',
  diagram: 'Diagram', combinator: 'Combinator', 'ai-instructions': 'AI',
  graph: 'Graph', 'quality-control': 'Quality', claude: 'Claude',
  history: 'History', starred: 'Starred', list: 'List', board: 'Board',
  gallery: 'Gallery', calendar: 'Calendar', 'mission-control': 'Mission',
  settings: 'Settings', todo: 'Todo',
};

function uid() { return crypto.randomUUID(); }

// ─── Per-pane location context override ──────────────────────────────────────

function PaneLocationWrapper({
  itemId,
  onSetItemId,
  children,
}: {
  itemId: string | null;
  onSetItemId: (id: string | null) => void;
  children: ReactNode;
}) {
  const parent = useContext(LocationContext);
  const value = { ...parent, itemId, setItemId: onSetItemId };
  return <LocationContext.Provider value={value}>{children}</LocationContext.Provider>;
}

// ─── View renderer ────────────────────────────────────────────────────────────

function PaneTreeView({ paneId }: { paneId: string }) {
  const { getApi, activeWorkspaceId } = useWorkspaceStore();
  const { focusedItemId, setFocusedItem, vscodeAvailable } = useUiStore();
  const { setItemId, openOverlay } = useLocation();
  return (
    <TreeView
      panelId={paneId}
      api={getApi()}
      workspaceKey={activeWorkspaceId ?? undefined}
      focusedItemId={focusedItemId}
      vscodeAvailable={vscodeAvailable}
      onFocusItem={(id) => setFocusedItem(id)}
      onSelectItem={(id) => setItemId(id)}
      onOpenOverlay={openOverlay}
    />
  );
}

function renderPaneView(viewType: string, paneId: string): ReactNode {
  switch (viewType) {
    case 'tree': return <PaneTreeView paneId={paneId} />;
    case 'table': return <TableView />;
    case 'types': return <TypesView />;
    case 'board': return <BoardView panelId={paneId} />;
    case 'gallery': return <GalleryView panelId={paneId} />;
    case 'list': return <ListView panelId={paneId} />;
    case 'calendar': return <CalendarView panelId={paneId} />;
    case 'graph': return <GraphView />;
    case 'combinator': return <CombinatorView />;
    case 'mission-control': return <MissionControl />;
    case 'quality-control': return <QualityControlView />;
    case 'history': return <HistoryView />;
    case 'starred': return <StarredView />;
    case 'ai-instructions': return <AIInstructionsView />;
    case 'claude': return <ClaudeView />;
    case 'diagram': return <DiagramView />;
    case 'functions': return <FunctionsView />;
    case 'todo': return <TodoView />;
    default: return <div className="LayoutsView-pane-placeholder">{viewType}</div>;
  }
}

// ─── View picker ─────────────────────────────────────────────────────────────

function ViewPicker({ onPick }: { onPick: (viewType: string) => void }) {
  return (
    <div className="LayoutsView-picker">
      {Object.entries(VIEW_LABELS).map(([viewType, label]) => (
        <button key={viewType} className="LayoutsView-picker-item" onClick={() => onPick(viewType)}>
          {VIEW_ICONS[viewType]}
          <span>{label}</span>
        </button>
      ))}
    </div>
  );
}

// ─── Item input bar ───────────────────────────────────────────────────────────

function PaneItemInput({
  itemId,
  onSetItemId,
}: {
  itemId: string | null;
  onSetItemId: (id: string | null) => void;
}) {
  const [value, setValue] = useState('');
  const { getApi } = useWorkspaceStore();

  const handleKeyDown = async (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key !== 'Enter') return;
    const input = value.trim();
    if (!input) { onSetItemId(null); setValue(''); return; }
    if (UUID_RE.test(input)) { onSetItemId(input); setValue(''); return; }
    try {
      const entry = await getApi().aliases.resolve(input.toLowerCase());
      onSetItemId(entry.targetId);
      setValue('');
    } catch {
      // alias not found
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

// ─── Leaf pane ────────────────────────────────────────────────────────────────

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
  const setItemId = useCallback((id: string | null) => onUpdate({ itemId: id }), [onUpdate]);

  return (
    <PaneLocationWrapper itemId={node.itemId} onSetItemId={setItemId}>
      <div className="LayoutsView-leaf">
        <div className="LayoutsView-leaf-toolbar">
          <span className="LayoutsView-leaf-view-label">
            {node.viewType ? (VIEW_ICONS[node.viewType] ?? null) : null}
            <span>{node.viewType ? VIEW_LABELS[node.viewType] ?? node.viewType : 'Pick a view'}</span>
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
            ? renderPaneView(node.viewType, node.id)
            : <ViewPicker onPick={viewType => onUpdate({ viewType })} />}
        </div>
      </div>
    </PaneLocationWrapper>
  );
}

// ─── Split pane ───────────────────────────────────────────────────────────────

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

  const isH = node.direction === 'horizontal';

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
        title={isH ? 'Drag to resize' : 'Drag to resize'}
      />
      <div className="LayoutsView-split-child" style={{ flexBasis: `${node.sizes[1]}%` }}>
        {renderNode(node.children[1], 1)}
      </div>
    </div>
  );
}

// ─── Root pane renderer ───────────────────────────────────────────────────────

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

// ─── Tab bar ──────────────────────────────────────────────────────────────────

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

// ─── Main ─────────────────────────────────────────────────────────────────────

export function LayoutsView() {
  const { getApi } = useWorkspaceStore();
  const api = getApi();
  const qc = useQueryClient();
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [layout, setLayout] = useState<LayoutData | null>(null);

  useQuery({
    queryKey: ['layouts'],
    queryFn: async () => {
      const data = await api.layouts.get();
      setLayout(data);
      return data;
    },
    staleTime: Infinity,
  });

  const persist = useCallback((data: LayoutData) => {
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      void api.layouts.save(data).then(() => {
        void qc.invalidateQueries({ queryKey: ['layouts'] });
      });
    }, 500);
  }, [api, qc]);

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
  );
}
