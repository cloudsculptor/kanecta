import type { ViewMeta } from '../../../lib/viewMeta';
import { useViewLocation } from '../../../context/LocationContext';
import AccountTreeIcon from '@mui/icons-material/AccountTree';
import AutoAwesomeIcon from '@mui/icons-material/AutoAwesome';
import BubbleChartIcon from '@mui/icons-material/BubbleChart';
import DashboardCustomizeIcon from '@mui/icons-material/DashboardCustomize';
import DateRangeIcon from '@mui/icons-material/DateRange';
import FactCheckIcon from '@mui/icons-material/FactCheck';
import FlightIcon from '@mui/icons-material/Flight';
import GridViewIcon from '@mui/icons-material/GridView';
import HistoryIcon from '@mui/icons-material/History';
import InboxIcon from '@mui/icons-material/Inbox';
import IosShareIcon from '@mui/icons-material/IosShare';
import ManageSearchIcon from '@mui/icons-material/ManageSearch';
import MergeTypeIcon from '@mui/icons-material/MergeType';
import PsychologyIcon from '@mui/icons-material/Psychology';
import SchemaIcon from '@mui/icons-material/Schema';
import SettingsIcon from '@mui/icons-material/Settings';
import StarIcon from '@mui/icons-material/Star';
import StorefrontIcon from '@mui/icons-material/Storefront';
import SyncIcon from '@mui/icons-material/Sync';
import TableChartIcon from '@mui/icons-material/TableChart';
import ViewKanbanIcon from '@mui/icons-material/ViewKanban';
import ViewListIcon from '@mui/icons-material/ViewList';
import { HomeView as HomeViewPkg } from '@kanecta/component-home-view';
import { useUiStore } from '../../../store/ui';
import type { ViewType } from '../../../types/ui';

export const HomeViewMeta: ViewMeta = {
  uuid: 'f9e8a7b6-c0d1-4e2f-3a4b-5c6d7e8f9a0b',
  name: 'home',
  label: 'Home',
  icon: 'Home',
};

const NAV_ITEMS = [
  { id: 'tree',            label: 'Tree',       icon: <AccountTreeIcon />,        disabled: false },
  { id: 'types',           label: 'Types',      icon: <DashboardCustomizeIcon />, disabled: false },
  { id: 'table',           label: 'Table',      icon: <TableChartIcon />,         disabled: false },
  { id: 'combinator',      label: 'Combinator', icon: <MergeTypeIcon />,          disabled: false },
  { id: 'ai-instructions', label: 'AI',         icon: <PsychologyIcon />,         disabled: false },
  { id: 'history',         label: 'History',    icon: <HistoryIcon />,            disabled: false },
  { id: 'starred',         label: 'Starred',    icon: <StarIcon />,               disabled: false },
  { id: 'graph',           label: 'Graph',      icon: <BubbleChartIcon />,        disabled: false },
  { id: 'quality-control', label: 'Quality',    icon: <FactCheckIcon />,          disabled: false },
  { id: 'list',            label: 'List',       icon: <ViewListIcon />,           disabled: false },
  { id: 'board',           label: 'Board',      icon: <ViewKanbanIcon />,         disabled: false },
  { id: 'gallery',         label: 'Gallery',    icon: <GridViewIcon />,           disabled: false },
  { id: 'calendar',        label: 'Calendar',   icon: <DateRangeIcon />,          disabled: false },
  { id: 'mission-control', label: 'Mission',    icon: <FlightIcon />,             disabled: false },
  { id: 'claude',          label: 'Claude',     icon: <AutoAwesomeIcon />,        disabled: false },
  { id: 'diagram',         label: 'Diagram',    icon: <SchemaIcon />,             disabled: false },
  { id: 'settings',        label: 'Settings',   icon: <SettingsIcon />,           disabled: false },
  { id: 'query',           label: 'Query',      icon: <ManageSearchIcon />,       disabled: true },
  { id: 'inbox',           label: 'Inbox',      icon: <InboxIcon />,              disabled: true },
  { id: 'export',          label: 'Export',     icon: <IosShareIcon />,           disabled: true },
  { id: 'marketplace',     label: 'Market',     icon: <StorefrontIcon />,         disabled: true },
  { id: 'sync',            label: 'Sync',       icon: <SyncIcon />,               disabled: true },
];

export function HomeView() {
  useViewLocation(HomeViewMeta.uuid);
  const { layout, updatePanel } = useUiStore();

  const handleNavigate = (viewId: string) => {
    const panelId = layout.panels[0]?.id;
    if (panelId) updatePanel(panelId, { viewType: viewId as ViewType });
  };

  return <HomeViewPkg items={NAV_ITEMS} onNavigate={handleNavigate} />;
}
