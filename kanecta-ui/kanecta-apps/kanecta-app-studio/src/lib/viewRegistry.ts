import type { ComponentType } from 'react';
import type { ViewMeta } from './viewMeta';
import type { ViewComponentProps } from './componentLoader';
import { softComponentRegistry, viewTypeToComponentId } from './componentRegistry';
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
import { IntegrityViewMeta } from '../components/views/IntegrityView/IntegrityView';
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
  MissionControlMeta, QualityControlViewMeta, IntegrityViewMeta, HistoryViewMeta, StarredViewMeta,
  DigestViewMeta, AIInstructionsViewMeta, ClaudeViewMeta, PullRequestsViewMeta,
  PipelineViewMeta, FramesViewMeta, SettingsViewMeta, HomeViewMeta,
];

export const VIEW_REGISTRY: Record<string, ViewMeta> = Object.fromEntries(
  ALL_METAS.map(m => [m.uuid, m])
);

/**
 * Soft-coded view resolution (see `componentRegistry.ts` for the Vite glue and
 * `componentLoader.ts` for the pure `buildComponentRegistry` core this sits
 * on). Gated behind `VITE_SOFT_COMPONENTS` — OFF by default, so the default
 * build is unchanged and resolves every view through the hardcoded switches
 * in `StudioPage.renderView` / `LayoutsView.renderPaneView` as before.
 *
 * `resolveSoftView` looks a Studio `ViewType` string up in the bundled
 * component registry and returns its `Component` (host state contract:
 * `{ state, onStateChange, api }`, see `ViewComponentProps`) — or `undefined`
 * if that view isn't registered yet, so callers can fall back to the
 * hardcoded case for just that view.
 */
export const SOFT_COMPONENTS_ENABLED = import.meta.env.VITE_SOFT_COMPONENTS === 'true';

export function resolveSoftView(
  viewType: string,
): ComponentType<ViewComponentProps<unknown, unknown> & Record<string, unknown>> | undefined {
  const componentId = viewTypeToComponentId(viewType);
  if (!componentId) return undefined;
  const entry = softComponentRegistry[componentId];
  return entry?.Component as
    | ComponentType<ViewComponentProps<unknown, unknown> & Record<string, unknown>>
    | undefined;
}
