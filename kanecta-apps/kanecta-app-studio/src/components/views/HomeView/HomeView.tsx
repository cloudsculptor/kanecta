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
import { useUiStore } from '../../../store/ui';
import type { ViewType } from '../../../types/ui';
import './HomeView.scss';

interface NavItem {
  view: ViewType;
  label: string;
  icon: React.ReactNode;
  disabled?: boolean;
}

const ALL_ITEMS: NavItem[] = [
  { view: 'tree',            label: 'Tree',          icon: <AccountTreeIcon /> },
  { view: 'types',           label: 'Types',          icon: <DashboardCustomizeIcon /> },
  { view: 'table',           label: 'Table',         icon: <TableChartIcon /> },
  { view: 'combinator',      label: 'Combinator',    icon: <MergeTypeIcon /> },
  { view: 'ai-instructions', label: 'AI',            icon: <PsychologyIcon /> },
  { view: 'history',         label: 'History',       icon: <HistoryIcon /> },
  { view: 'starred',         label: 'Starred',       icon: <StarIcon /> },
  { view: 'graph',           label: 'Graph',         icon: <BubbleChartIcon /> },
  { view: 'quality-control', label: 'Quality',       icon: <FactCheckIcon /> },
  { view: 'list',            label: 'List',          icon: <ViewListIcon /> },
  { view: 'board',           label: 'Board',         icon: <ViewKanbanIcon /> },
  { view: 'gallery',         label: 'Gallery',       icon: <GridViewIcon /> },
  { view: 'calendar',        label: 'Calendar',      icon: <DateRangeIcon /> },
  { view: 'mission-control', label: 'Mission',       icon: <FlightIcon /> },
  { view: 'claude',          label: 'Claude',        icon: <AutoAwesomeIcon /> },
  { view: 'diagram',         label: 'Diagram',       icon: <SchemaIcon /> },
  { view: 'settings',        label: 'Settings',      icon: <SettingsIcon /> },
  { view: 'query',           label: 'Query',         icon: <ManageSearchIcon />,  disabled: true },
  { view: 'inbox',           label: 'Inbox',         icon: <InboxIcon />,         disabled: true },
  { view: 'export',          label: 'Export',        icon: <IosShareIcon />,      disabled: true },
  { view: 'marketplace',     label: 'Market',        icon: <StorefrontIcon />,    disabled: true },
  { view: 'sync',            label: 'Sync',          icon: <SyncIcon />,          disabled: true },
];

export function HomeView() {
  const { layout, updatePanel } = useUiStore();

  const handleSelect = (view: ViewType) => {
    const panelId = layout.panels[0]?.id;
    if (panelId) updatePanel(panelId, { viewType: view });
  };

  return (
    <div className="HomeView">
      <div className="HomeView-grid">
        {ALL_ITEMS.map(({ view, label, icon, disabled }) => (
          <button
            key={view}
            className={['HomeView-item', disabled ? 'HomeView-item--disabled' : ''].filter(Boolean).join(' ')}
            onClick={() => !disabled && handleSelect(view)}
            aria-label={label}
            aria-disabled={disabled}
          >
            {icon}
            <span className="HomeView-item-label">{label}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
