import type { KanectaItem } from './kanecta';

export interface WorkingSetConfig {
  id: string;
  name: string;
  apiUrl: string;
  colour: string;
  pollIntervalMs: number;
  datastorePath?: string;
}

export interface ActivityEvent {
  id: string;
  workingSetId: string;
  item: KanectaItem;
  operation: 'created' | 'modified';
  seenAt: string;
}

export type WorkingSetStatus = 'green' | 'yellow' | 'red' | 'unknown';
