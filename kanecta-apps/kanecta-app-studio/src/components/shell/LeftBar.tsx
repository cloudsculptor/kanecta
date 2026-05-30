import AccountTreeIcon from '@mui/icons-material/AccountTree';
import BubbleChartIcon from '@mui/icons-material/BubbleChart';
import DashboardCustomizeIcon from '@mui/icons-material/DashboardCustomize';
import FactCheckIcon from '@mui/icons-material/FactCheck';
import HistoryIcon from '@mui/icons-material/History';
import MergeTypeIcon from '@mui/icons-material/MergeType';
import PsychologyIcon from '@mui/icons-material/Psychology';
import StarIcon from '@mui/icons-material/Star';
import TableChartIcon from '@mui/icons-material/TableChart';
import type { ViewType } from '../../types/ui';
import './LeftBar.scss';

interface NavItem {
  view: ViewType;
  label: string;
  icon: React.ReactNode;
  disabled?: boolean;
}

const NAV_ITEMS: NavItem[] = [
  { view: 'tree', label: 'Tree', icon: <AccountTreeIcon /> },
  { view: 'templates', label: 'Templates', icon: <DashboardCustomizeIcon /> },
  { view: 'table', label: 'Table', icon: <TableChartIcon /> },
  { view: 'combinator', label: 'Combinator', icon: <MergeTypeIcon /> },
  { view: 'ai-instructions', label: 'AI', icon: <PsychologyIcon /> },
  { view: 'history', label: 'History', icon: <HistoryIcon /> },
  { view: 'starred', label: 'Starred', icon: <StarIcon /> },
  { view: 'graph', label: 'Graph', icon: <BubbleChartIcon /> },
  { view: 'quality-control', label: 'Quality', icon: <FactCheckIcon /> },
];

interface LeftBarProps {
  activeView: ViewType;
  onViewSelect: (view: ViewType) => void;
}

export function LeftBar({ activeView, onViewSelect }: LeftBarProps) {
  return (
    <nav className="LeftBar">
      {NAV_ITEMS.map(({ view, label, icon, disabled }) => (
        <button
          key={view}
          className={[
            'LeftBar-item',
            activeView === view ? 'LeftBar-item--active' : '',
            disabled ? 'LeftBar-item--disabled' : '',
          ]
            .filter(Boolean)
            .join(' ')}
          onClick={() => !disabled && onViewSelect(view)}
          aria-label={label}
          aria-current={activeView === view ? 'page' : undefined}
          aria-disabled={disabled}
        >
          {icon}
          <span className="LeftBar-item-label">{label}</span>
        </button>
      ))}
    </nav>
  );
}
