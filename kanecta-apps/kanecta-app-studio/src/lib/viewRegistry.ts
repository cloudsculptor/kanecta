import type { ViewMeta } from './viewMeta';
import { TreeViewMeta } from '../components/views/TreeView/TreeView';
import { TableViewMeta } from '../components/views/TableView/TableView';
import { TypesViewMeta } from '../components/views/TemplatesView/TypesView';
import { BoardViewMeta } from '../components/views/BoardView/BoardView';
import { GalleryViewMeta } from '../components/views/GalleryView/GalleryView';
import { ListViewMeta } from '../components/views/ListView/ListView';
import { CalendarViewMeta } from '../components/views/CalendarView/CalendarView';
import { GraphViewMeta } from '../components/views/GraphView/GraphView';
import { CombinatorViewMeta } from '../components/views/CombinatorView/CombinatorView';
import { MissionControlMeta } from '../components/views/MissionControl/MissionControl';
import { QualityControlViewMeta } from '../components/views/QualityControlView/QualityControlView';
import { HistoryViewMeta } from '../components/views/HistoryView/HistoryView';
import { StarredViewMeta } from '../components/views/StarredView/StarredView';
import { DigestViewMeta } from '../components/views/MissionControl/DigestView';
import { AIInstructionsViewMeta } from '../components/views/AIInstructionsView/AIInstructionsView';
import { ClaudeViewMeta } from '../components/views/ClaudeView/ClaudeView';
import { SettingsViewMeta } from '../pages/SettingsPage';
import { HomeViewMeta } from '../components/views/HomeView/HomeView';
import { DiagramViewMeta } from '../components/views/DiagramView/DiagramView';

const ALL_METAS: ViewMeta[] = [
  TreeViewMeta, TableViewMeta, TypesViewMeta, BoardViewMeta, GalleryViewMeta,
  ListViewMeta, CalendarViewMeta, GraphViewMeta, CombinatorViewMeta,
  MissionControlMeta, QualityControlViewMeta, HistoryViewMeta, StarredViewMeta,
  DigestViewMeta, AIInstructionsViewMeta, ClaudeViewMeta, SettingsViewMeta,
  HomeViewMeta, DiagramViewMeta,
];

export const VIEW_REGISTRY: Record<string, ViewMeta> = Object.fromEntries(
  ALL_METAS.map(m => [m.uuid, m])
);
