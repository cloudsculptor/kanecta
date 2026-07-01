import type { ViewMeta } from './viewMeta';
import { TreeViewMeta } from '@kanecta/component-tree-view';
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
import { PullRequestsViewMeta } from '../components/views/PullRequestsView/PullRequestsView';
import { FramesViewMeta } from '../components/views/FramesView/FramesView';
import { PipelineViewMeta } from '../components/views/PipelineView/PipelineView';
import { SettingsViewMeta } from '../pages/SettingsPage';
import { HomeViewMeta } from '../components/views/HomeView/HomeView';

const ALL_METAS: ViewMeta[] = [
  TreeViewMeta, TableViewMeta, TypesViewMeta, BoardViewMeta, GalleryViewMeta,
  ListViewMeta, CalendarViewMeta, GraphViewMeta, CombinatorViewMeta,
  MissionControlMeta, QualityControlViewMeta, HistoryViewMeta, StarredViewMeta,
  DigestViewMeta, AIInstructionsViewMeta, ClaudeViewMeta, PullRequestsViewMeta,
  PipelineViewMeta, FramesViewMeta, SettingsViewMeta, HomeViewMeta,
];

export const VIEW_REGISTRY: Record<string, ViewMeta> = Object.fromEntries(
  ALL_METAS.map(m => [m.uuid, m])
);
