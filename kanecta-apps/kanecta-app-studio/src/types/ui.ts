export type ViewType =
  | 'tree'
  | 'table'
  | 'templates'
  | 'combinator'
  | 'query'
  | 'marketplace'
  | 'inbox'
  | 'export'
  | 'board'
  | 'gallery'
  | 'list'
  | 'calendar'
  | 'graph'
  | 'mission-control'
  | 'quality-control'
  | 'ai-instructions'
  | 'history'
  | 'starred'
  | 'sync'
  | 'claude'
  | 'settings'
  | 'home';

export interface PanelConfig {
  id: string;
  viewType: ViewType;
  workspaceId?: string;
  filterType?: string;
  zoomedItemId?: string;
}

export interface PanelLayout {
  panels: PanelConfig[];
  sizes: number[];
}

export type SidebarState = 'collapsed' | 'icons' | 'expanded';

export interface FilterState {
  type?: string;
  confidence?: string;
  tags?: string[];
  search?: string;
}

export interface SortState {
  field: 'value' | 'createdAt' | 'modifiedAt' | 'sortOrder' | 'confidence';
  direction: 'asc' | 'desc';
}
