import type { KanectaItem } from './kanecta';

export interface WorkspaceConfig {
  id: string;
  name: string;
  apiUrl: string;
  colour: string;
  pollIntervalMs: number;
  datastorePath?: string;
}

export interface ActivityEvent {
  id: string;
  workspaceId: string;
  item: KanectaItem;
  operation: 'created' | 'modified';
  seenAt: string;
}

export type WorkspaceStatus = 'green' | 'yellow' | 'red' | 'unknown';
