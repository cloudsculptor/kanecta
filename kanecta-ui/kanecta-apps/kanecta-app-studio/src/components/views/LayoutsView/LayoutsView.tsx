import { useContext, type ReactNode } from 'react';
import { useLocation } from '../../../context/LocationContext';
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
import SettingsIcon from '@mui/icons-material/Settings';
import StarIcon from '@mui/icons-material/Star';
import TableChartIcon from '@mui/icons-material/TableChart';
import ViewKanbanIcon from '@mui/icons-material/ViewKanban';
import ViewListIcon from '@mui/icons-material/ViewList';
import AltRouteIcon from '@mui/icons-material/AltRoute';
import type { ViewMeta } from '../../../lib/viewMeta';
import { useViewLocation, LocationContext } from '../../../context/LocationContext';
import { useWorkingSetStore } from '../../../store/workingSet';
import { useUiStore } from '../../../store/ui';
import { LayoutsView as LayoutsViewPkg } from '@kanecta/component-layouts-view';
import type { AvailableView } from '@kanecta/component-layouts-view';
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
import { FunctionsView } from '../FunctionsView/FunctionsView';
import { TodoView } from '../TodoView/TodoView';
import { PullRequestsView } from '../PullRequestsView/PullRequestsView';

export const LayoutsViewMeta: ViewMeta = {
  uuid: 'a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d',
  name: 'layouts',
  label: 'Layouts',
  icon: 'Dashboard',
};

const AVAILABLE_VIEWS: AvailableView[] = [
  { id: 'tree',            label: 'Tree',        icon: <AccountTreeIcon /> },
  { id: 'types',           label: 'Types',       icon: <DashboardCustomizeIcon /> },
  { id: 'table',           label: 'Table',       icon: <TableChartIcon /> },
  { id: 'functions',       label: 'Functions',   icon: <FunctionsIcon /> },
  { id: 'combinator',      label: 'Combinator',  icon: <MergeTypeIcon /> },
  { id: 'ai-instructions', label: 'AI',          icon: <PsychologyIcon /> },
  { id: 'graph',           label: 'Graph',       icon: <BubbleChartIcon /> },
  { id: 'quality-control', label: 'Quality',     icon: <FactCheckIcon /> },
  { id: 'claude',          label: 'Claude',      icon: <AutoAwesomeIcon /> },
  { id: 'history',         label: 'History',     icon: <HistoryIcon /> },
  { id: 'starred',         label: 'Starred',     icon: <StarIcon /> },
  { id: 'list',            label: 'List',        icon: <ViewListIcon /> },
  { id: 'board',           label: 'Board',       icon: <ViewKanbanIcon /> },
  { id: 'gallery',         label: 'Gallery',     icon: <GridViewIcon /> },
  { id: 'calendar',        label: 'Calendar',    icon: <DateRangeIcon /> },
  { id: 'mission-control', label: 'Mission',     icon: <FlightIcon /> },
  { id: 'settings',        label: 'Settings',    icon: <SettingsIcon /> },
  { id: 'todo',            label: 'Todo',        icon: <ChecklistIcon /> },
  { id: 'pull-requests',   label: 'Pull Requests', icon: <AltRouteIcon /> },
];

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

function PaneTreeView({ paneId }: { paneId: string }) {
  const { getApi, activeWorkingSetId } = useWorkingSetStore();
  const { focusedItemId, setFocusedItem, vscodeAvailable } = useUiStore();
  const { setItemId, openOverlay } = useLocation();
  return (
    <TreeView
      panelId={paneId}
      api={getApi()}
      workspaceKey={activeWorkingSetId ?? undefined}
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
    case 'tree':            return <PaneTreeView paneId={paneId} />;
    case 'table':           return <TableView />;
    case 'types':           return <TypesView />;
    case 'board':           return <BoardView panelId={paneId} />;
    case 'gallery':         return <GalleryView panelId={paneId} />;
    case 'list':            return <ListView panelId={paneId} />;
    case 'calendar':        return <CalendarView panelId={paneId} />;
    case 'graph':           return <GraphView />;
    case 'combinator':      return <CombinatorView />;
    case 'mission-control': return <MissionControl />;
    case 'quality-control': return <QualityControlView />;
    case 'history':         return <HistoryView />;
    case 'starred':         return <StarredView />;
    case 'ai-instructions': return <AIInstructionsView />;
    case 'claude':          return <ClaudeView />;
    case 'functions':       return <FunctionsView />;
    case 'todo':            return <TodoView />;
    case 'pull-requests':   return <PullRequestsView />;
    default:                return <div style={{ padding: 24, color: '#888' }}>{viewType}</div>;
  }
}

export function LayoutsView() {
  useViewLocation(LayoutsViewMeta.uuid);
  const { getApi } = useWorkingSetStore();
  const api = getApi();

  return (
    <LayoutsViewPkg
      onFetchLayout={() => api.layouts.get()}
      onSaveLayout={(data) => api.layouts.save(data)}
      onResolveAlias={async (alias) => {
        try {
          const entry = await api.aliases.resolve(alias.toLowerCase());
          return entry.targetId;
        } catch {
          return null;
        }
      }}
      renderView={(viewType, paneId, itemId, onSetItemId) => (
        <PaneLocationWrapper itemId={itemId} onSetItemId={onSetItemId}>
          {renderPaneView(viewType, paneId)}
        </PaneLocationWrapper>
      )}
      availableViews={AVAILABLE_VIEWS}
    />
  );
}
