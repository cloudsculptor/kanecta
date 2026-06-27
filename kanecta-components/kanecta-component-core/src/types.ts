export type Confidence = 'experimental' | 'exploring' | 'decided' | 'locked';

export type ItemType = string;

export interface KanectaItem {
  id: string;
  value: string;
  type: ItemType;
  typeId?: string | null;
  parentId?: string | null;
  sortOrder: number | null;
  tags: string[];
  confidence: Confidence | null;
  status?: string | null;
  license?: string | null;
  createdAt: string | null;
  modifiedAt: string | null;
  completedAt?: string | null;
  childCount?: number;
  icon?: string | null;
}

export interface QueryFilter {
  parentId?: string;
  type?: string;
  search?: string;
  [key: string]: unknown;
}

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
