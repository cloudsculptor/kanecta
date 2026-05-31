import { IconButton, Tooltip } from '@mui/material';
import AccountTreeIcon from '@mui/icons-material/AccountTree';
import TableChartIcon from '@mui/icons-material/TableChart';
import DashboardCustomizeIcon from '@mui/icons-material/DashboardCustomize';
import MergeTypeIcon from '@mui/icons-material/MergeType';
import ManageSearchIcon from '@mui/icons-material/ManageSearch';
import StorefrontIcon from '@mui/icons-material/Storefront';
import InboxIcon from '@mui/icons-material/Inbox';
import IosShareIcon from '@mui/icons-material/IosShare';
import ViewKanbanIcon from '@mui/icons-material/ViewKanban';
import GridViewIcon from '@mui/icons-material/GridView';
import ViewListIcon from '@mui/icons-material/ViewList';
import DateRangeIcon from '@mui/icons-material/DateRange';
import BubbleChartIcon from '@mui/icons-material/BubbleChart';
import FlightIcon from '@mui/icons-material/Flight';
import PsychologyIcon from '@mui/icons-material/Psychology';
import SyncIcon from '@mui/icons-material/Sync';
function ClaudeIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path d="M12 2C6.477 2 2 6.477 2 12s4.477 10 10 10 10-4.477 10-10S17.523 2 12 2z" fill="#CC785C" />
      <path d="M14.5 7.5L10 16.5M9.5 7.5L14 16.5" stroke="white" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}
import FactCheckIcon from '@mui/icons-material/FactCheck';
import HistoryIcon from '@mui/icons-material/History';
import StarIcon from '@mui/icons-material/Star';
import ChevronLeftIcon from '@mui/icons-material/ChevronLeft';
import ChevronRightIcon from '@mui/icons-material/ChevronRight';
import type { SidebarState, ViewType } from '../../types/ui';
import './LeftSidebar.scss';

interface NavItem {
  view: ViewType;
  label: string;
  icon: React.ReactNode;
  disabled?: boolean;
}

type NavEntry = NavItem | { divider: true };

const NAV_ITEMS: NavEntry[] = [
  { view: 'tree', label: 'Tree', icon: <AccountTreeIcon fontSize="small" /> },
  { view: 'templates', label: 'Templates', icon: <DashboardCustomizeIcon fontSize="small" /> },
  { view: 'table', label: 'Table', icon: <TableChartIcon fontSize="small" /> },
  { view: 'combinator', label: 'Combinator', icon: <MergeTypeIcon fontSize="small" /> },
  { view: 'ai-instructions', label: 'AI Instructions', icon: <PsychologyIcon fontSize="small" /> },
  { view: 'history', label: 'History', icon: <HistoryIcon fontSize="small" /> },
  { view: 'starred', label: 'Starred', icon: <StarIcon fontSize="small" /> },
  { view: 'graph', label: 'Graph', icon: <BubbleChartIcon fontSize="small" /> },
  { view: 'quality-control', label: 'Quality Control', icon: <FactCheckIcon fontSize="small" /> },
  { divider: true },
  { view: 'list', label: 'List', icon: <ViewListIcon fontSize="small" /> },
  { view: 'board', label: 'Board', icon: <ViewKanbanIcon fontSize="small" /> },
  { view: 'gallery', label: 'Gallery', icon: <GridViewIcon fontSize="small" /> },
  { view: 'calendar', label: 'Calendar', icon: <DateRangeIcon fontSize="small" /> },
  { view: 'mission-control', label: 'Mission Control', icon: <FlightIcon fontSize="small" /> },
  { view: 'claude', label: 'Claude CLI', icon: <ClaudeIcon /> },
  { divider: true },
  { view: 'query', label: 'Query', icon: <ManageSearchIcon fontSize="small" />, disabled: true },
  { view: 'inbox', label: 'Inbox', icon: <InboxIcon fontSize="small" />, disabled: true },
  { view: 'export', label: 'Export', icon: <IosShareIcon fontSize="small" />, disabled: true },
  { divider: true },
  { view: 'marketplace', label: 'Marketplace', icon: <StorefrontIcon fontSize="small" />, disabled: true },
  { view: 'sync', label: 'Sync', icon: <SyncIcon fontSize="small" />, disabled: true },
];

interface LeftSidebarProps {
  state: SidebarState;
  activeView: ViewType;
  onViewSelect: (view: ViewType) => void;
  onToggle: () => void;
}

export function LeftSidebar({ state, activeView, onViewSelect, onToggle }: LeftSidebarProps) {
  const isExpanded = state === 'expanded';

  return (
    <aside className={`LeftSidebar LeftSidebar--${state}`}>
      <nav className="LeftSidebar-nav">
        {NAV_ITEMS.map((entry, i) => {
          if ('divider' in entry) {
            return <hr key={`divider-${i}`} className="LeftSidebar-divider" />;
          }
          const { view, label, icon, disabled } = entry;
          const button = (
            <button
              key={view}
              className={`LeftSidebar-item${activeView === view ? ' LeftSidebar-item--active' : ''}${disabled ? ' LeftSidebar-item--disabled' : ''}`}
              onClick={() => !disabled && onViewSelect(view)}
              aria-label={label}
              aria-current={activeView === view ? 'page' : undefined}
              aria-disabled={disabled}
            >
              {icon}
              {isExpanded && <span className="LeftSidebar-item-label">{label}</span>}
            </button>
          );
          return isExpanded ? button : (
            <Tooltip key={view} title={label} placement="right">
              {button}
            </Tooltip>
          );
        })}
      </nav>
      <div className="LeftSidebar-toggle">
        <Tooltip title={isExpanded ? 'Collapse sidebar' : 'Expand sidebar'} placement="right">
          <IconButton size="small" onClick={onToggle} aria-label="Toggle sidebar">
            {isExpanded ? <ChevronLeftIcon fontSize="small" /> : <ChevronRightIcon fontSize="small" />}
          </IconButton>
        </Tooltip>
      </div>
    </aside>
  );
}
