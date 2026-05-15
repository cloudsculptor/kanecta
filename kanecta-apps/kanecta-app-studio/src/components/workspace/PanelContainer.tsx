import { IconButton, Tooltip } from '@mui/material';
import AccountTreeIcon from '@mui/icons-material/AccountTree';
import TableChartIcon from '@mui/icons-material/TableChart';
import ViewKanbanIcon from '@mui/icons-material/ViewKanban';
import GridViewIcon from '@mui/icons-material/GridView';
import ViewListIcon from '@mui/icons-material/ViewList';
import DateRangeIcon from '@mui/icons-material/DateRange';
import BubbleChartIcon from '@mui/icons-material/BubbleChart';
import FlightIcon from '@mui/icons-material/Flight';
import CloseIcon from '@mui/icons-material/Close';
import type { ViewType, PanelConfig } from '../../types/ui';
import { useUiStore } from '../../store/ui';
import './PanelContainer.scss';

const VIEW_TABS: { view: ViewType; label: string; icon: React.ReactNode }[] = [
  { view: 'tree', label: 'Tree', icon: <AccountTreeIcon sx={{ fontSize: 14 }} /> },
  { view: 'table', label: 'Table', icon: <TableChartIcon sx={{ fontSize: 14 }} /> },
  { view: 'board', label: 'Board', icon: <ViewKanbanIcon sx={{ fontSize: 14 }} /> },
  { view: 'gallery', label: 'Gallery', icon: <GridViewIcon sx={{ fontSize: 14 }} /> },
  { view: 'list', label: 'List', icon: <ViewListIcon sx={{ fontSize: 14 }} /> },
  { view: 'calendar', label: 'Calendar', icon: <DateRangeIcon sx={{ fontSize: 14 }} /> },
  { view: 'graph', label: 'Graph', icon: <BubbleChartIcon sx={{ fontSize: 14 }} /> },
  {
    view: 'mission-control',
    label: 'Mission Control',
    icon: <FlightIcon sx={{ fontSize: 14 }} />,
  },
];

interface PanelContainerProps {
  panel: PanelConfig;
  canClose?: boolean;
  children: React.ReactNode;
}

export function PanelContainer({ panel, canClose, children }: PanelContainerProps) {
  const { updatePanel, removePanel } = useUiStore();

  return (
    <div className="PanelContainer">
      <div className="PanelContainer-header">
        <div className="PanelContainer-view-tabs">
          {VIEW_TABS.map(({ view, label, icon }) => (
            <Tooltip key={view} title={label}>
              <button
                className={`PanelContainer-view-tab${panel.viewType === view ? ' PanelContainer-view-tab--active' : ''}`}
                onClick={() => updatePanel(panel.id, { viewType: view })}
                aria-label={label}
                aria-pressed={panel.viewType === view}
              >
                {icon}
                <span>{label}</span>
              </button>
            </Tooltip>
          ))}
        </div>
        <div className="PanelContainer-spacer" />
        {canClose && (
          <Tooltip title="Close panel">
            <IconButton size="small" onClick={() => removePanel(panel.id)} aria-label="Close panel">
              <CloseIcon sx={{ fontSize: 14 }} />
            </IconButton>
          </Tooltip>
        )}
      </div>
      <div className="PanelContainer-content">{children}</div>
    </div>
  );
}
