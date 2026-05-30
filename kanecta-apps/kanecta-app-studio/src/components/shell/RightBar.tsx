import DateRangeIcon from '@mui/icons-material/DateRange';
import FlightIcon from '@mui/icons-material/Flight';
import GridViewIcon from '@mui/icons-material/GridView';
import InboxIcon from '@mui/icons-material/Inbox';
import IosShareIcon from '@mui/icons-material/IosShare';
import ManageSearchIcon from '@mui/icons-material/ManageSearch';
import StorefrontIcon from '@mui/icons-material/Storefront';
import SyncIcon from '@mui/icons-material/Sync';
import ViewKanbanIcon from '@mui/icons-material/ViewKanban';
import type { ViewType } from '../../types/ui';
import './RightBar.scss';

function ClaudeIcon() {
  return (
    <svg width="28" height="28" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path d="M12 2C6.477 2 2 6.477 2 12s4.477 10 10 10 10-4.477 10-10S17.523 2 12 2z" fill="#CC785C" />
      <path d="M14.5 7.5L10 16.5M9.5 7.5L14 16.5" stroke="white" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}

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
  { view: 'claude', label: 'Claude', icon: <ClaudeIcon /> },
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
