export interface MissionWorkspace {
  id: string;
  name: string;
  colour?: string;
  pollIntervalMs?: number;
}

export interface MissionActivityEvent {
  id: string;
  workspaceId: string;
  operation: 'created' | 'modified';
  item: { id: string; value: string; parentId?: string | null };
  seenAt: string;
}

export interface MissionReviewItem {
  id: string;
  value: string;
  type: string;
  confidence?: string | null;
  tags: string[];
  createdAt?: string | null;
}

export interface MissionItem {
  id: string;
  value: string;
  type: string;
  confidence?: string | null;
  tags: string[];
  parentId?: string | null;
  modifiedAt?: string | null;
}

export type WorkspaceStatus = 'green' | 'yellow' | 'red' | 'unknown';

export interface ConflictPair {
  id: string;
  itemA: MissionItem;
  workspaceIdA: string;
  itemB: MissionItem;
  workspaceIdB: string;
  similarity: number;
  reason: 'value-similarity' | 'shared-parent';
}

export interface DigestGroup {
  parentId: string | null;
  parentValue: string;
  events: MissionActivityEvent[];
  createdCount: number;
  modifiedCount: number;
  latestAt: string;
}

export interface Digest {
  groups: DigestGroup[];
  totalEvents: number;
  conflictCount: number;
  reviewBacklogCount: number;
  lastActiveAt: string | null;
}

export interface MissionControlProps {
  workspaces: MissionWorkspace[];
  activityLog: MissionActivityEvent[];
  reviewQueue: MissionReviewItem[];
  conveyorIndex: number;
  onAdvanceConveyor: () => void;
  onMarkSeen: (ids: string[]) => void;
  onFocusItem: (id: string) => void;
  onFetchWorkspaceItems: (workspaceId: string) => Promise<MissionItem[]>;
  onApproveItem: (id: string) => Promise<unknown>;
  onDeleteItem: (id: string) => Promise<unknown>;
  queryKeyPrefix?: string;
}

export interface DigestViewProps {
  workspaces: MissionWorkspace[];
  activityLog: MissionActivityEvent[];
  reviewQueueLength: number;
  onFetchWorkspaceItems: (workspaceId: string) => Promise<MissionItem[]>;
  onDeleteItem: (workspaceId: string, itemId: string) => Promise<unknown>;
  queryKeyPrefix?: string;
}
