import DateRangeIcon from '@mui/icons-material/DateRange';
import FlightIcon from '@mui/icons-material/Flight';
import GridViewIcon from '@mui/icons-material/GridView';
import InboxIcon from '@mui/icons-material/Inbox';
import IosShareIcon from '@mui/icons-material/IosShare';
import ManageSearchIcon from '@mui/icons-material/ManageSearch';
import StorefrontIcon from '@mui/icons-material/Storefront';
import SyncIcon from '@mui/icons-material/Sync';
import AutoAwesomeIcon from '@mui/icons-material/AutoAwesome';
import ViewKanbanIcon from '@mui/icons-material/ViewKanban';
import type { ViewType } from '../../types/ui';
import './RightBar.scss';

interface NavItem {
  view: ViewType;
  label: string;
  icon: React.ReactNode;
  disabled?: boolean;
}

const NAV_ITEMS: NavItem[] = [
  { view: 'board', label: 'Board', icon: <ViewKanbanIcon /> },
  { view: 'gallery', label: 'Gallery', icon: <GridViewIcon /> },
  { view: 'calendar', label: 'Calendar', icon: <DateRangeIcon /> },
  { view: 'mission-control', label: 'Mission', icon: <FlightIcon /> },
  { view: 'claude', label: 'Claude', icon: <AutoAwesomeIcon /> },
  { view: 'query', label: 'Query', icon: <ManageSearchIcon />, disabled: true },
  { view: 'inbox', label: 'Inbox', icon: <InboxIcon />, disabled: true },
  { view: 'export', label: 'Export', icon: <IosShareIcon />, disabled: true },
  { view: 'marketplace', label: 'Market', icon: <StorefrontIcon />, disabled: true },
  { view: 'sync', label: 'Sync', icon: <SyncIcon />, disabled: true },
];

interface RightBarProps {
  activeView: ViewType;
  onViewSelect: (view: ViewType) => void;
}

export function RightBar({ activeView, onViewSelect }: RightBarProps) {
  return (
    <nav className="RightBar">
      {NAV_ITEMS.map(({ view, label, icon, disabled }) => (
        <button
          key={view}
          className={[
            'RightBar-item',
            activeView === view ? 'RightBar-item--active' : '',
            disabled ? 'RightBar-item--disabled' : '',
          ]
            .filter(Boolean)
            .join(' ')}
          onClick={() => !disabled && onViewSelect(view)}
          aria-label={label}
          aria-current={activeView === view ? 'page' : undefined}
          aria-disabled={disabled}
        >
          {icon}
          <span className="RightBar-item-label">{label}</span>
        </button>
      ))}
    </nav>
  );
}
