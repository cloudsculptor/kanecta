import { IconButton, Tooltip } from '@mui/material';
import AccountTreeIcon from '@mui/icons-material/AccountTree';
import TableChartIcon from '@mui/icons-material/TableChart';
import ViewKanbanIcon from '@mui/icons-material/ViewKanban';
import GridViewIcon from '@mui/icons-material/GridView';
import ViewListIcon from '@mui/icons-material/ViewList';
import DateRangeIcon from '@mui/icons-material/DateRange';
import BubbleChartIcon from '@mui/icons-material/BubbleChart';
import FlightIcon from '@mui/icons-material/Flight';
import ChevronLeftIcon from '@mui/icons-material/ChevronLeft';
import ChevronRightIcon from '@mui/icons-material/ChevronRight';
import type { SidebarState, ViewType } from '../../types/ui';
import './LeftSidebar.scss';

interface NavItem {
  view: ViewType;
  label: string;
  icon: React.ReactNode;
}

const NAV_ITEMS: NavItem[] = [
  { view: 'tree', label: 'Tree', icon: <AccountTreeIcon fontSize="small" /> },
  { view: 'table', label: 'Table', icon: <TableChartIcon fontSize="small" /> },
  { view: 'board', label: 'Board', icon: <ViewKanbanIcon fontSize="small" /> },
  { view: 'gallery', label: 'Gallery', icon: <GridViewIcon fontSize="small" /> },
  { view: 'list', label: 'List', icon: <ViewListIcon fontSize="small" /> },
  { view: 'calendar', label: 'Calendar', icon: <DateRangeIcon fontSize="small" /> },
  { view: 'graph', label: 'Graph', icon: <BubbleChartIcon fontSize="small" /> },
  { view: 'mission-control', label: 'Mission Control', icon: <FlightIcon fontSize="small" /> },
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
        {NAV_ITEMS.map(({ view, label, icon }) => {
          const button = (
            <button
              key={view}
              className={`LeftSidebar-item${activeView === view ? ' LeftSidebar-item--active' : ''}`}
              onClick={() => onViewSelect(view)}
              aria-label={label}
              aria-current={activeView === view ? 'page' : undefined}
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
