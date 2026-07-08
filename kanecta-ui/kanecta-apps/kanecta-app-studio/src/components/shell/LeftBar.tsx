import AccountTreeIcon from '@mui/icons-material/AccountTree';
import BubbleChartIcon from '@mui/icons-material/BubbleChart';
import DashboardCustomizeIcon from '@mui/icons-material/DashboardCustomize';
import FactCheckIcon from '@mui/icons-material/FactCheck';
import FunctionsIcon from '@mui/icons-material/Functions';
import MergeTypeIcon from '@mui/icons-material/MergeType';
import PsychologyIcon from '@mui/icons-material/Psychology';
import TableChartIcon from '@mui/icons-material/TableChart';
import AutoAwesomeIcon from '@mui/icons-material/AutoAwesome';
import AltRouteIcon from '@mui/icons-material/AltRoute';
import PlayCircleOutlineIcon from '@mui/icons-material/PlayCircleOutlined';
import GridViewIcon from '@mui/icons-material/GridView';
import HealthAndSafetyIcon from '@mui/icons-material/HealthAndSafety';
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
  { view: 'types', label: 'Types', icon: <DashboardCustomizeIcon /> },
  { view: 'table', label: 'Table', icon: <TableChartIcon /> },
  { view: 'pipelines', label: 'Pipelines', icon: <PlayCircleOutlineIcon /> },
  { view: 'functions', label: 'Functions', icon: <FunctionsIcon /> },
  { view: 'combinator', label: 'Combinator', icon: <MergeTypeIcon /> },
  { view: 'ai-instructions', label: 'AI', icon: <PsychologyIcon /> },
  { view: 'graph', label: 'Graph', icon: <BubbleChartIcon /> },
  { view: 'quality-control', label: 'Quality', icon: <FactCheckIcon /> },
  { view: 'integrity', label: 'Integrity', icon: <HealthAndSafetyIcon /> },
  { view: 'frames', label: 'Frames', icon: <GridViewIcon /> },
  { view: 'claude', label: 'Claude', icon: <AutoAwesomeIcon /> },
  { view: 'pull-requests', label: 'PR', icon: <AltRouteIcon /> },
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
