import primitiveSpec from '@kanecta/specification/1.4.0/built-in-types/built-in-types.json';

export type ItemType =
  | typeof primitiveSpec.primitive[number]
  | typeof primitiveSpec.structured[number];

export type Confidence = 'low' | 'medium' | 'high' | 'verified' | 'locked';

export type RelationshipType =
  | 'related'
  | 'supports'
  | 'contradicts'
  | 'depends_on'
  | 'part_of'
  | 'example_of'
  | 'caused_by';

export interface KanectaItem {
  id: string;
  value: string;
  type: ItemType;
  typeId?: string;
  confidence: Confidence | null;
  parentId?: string;
  sortOrder: number;
  tags: string[];
  license?: string;
  status?: string | null;
  workspaceId?: string;
  createdAt: string | null;
  modifiedAt: string | null;
  completedAt?: string | null;
  childCount?: number;
  icon?: string | null;
  _synthetic?: boolean;
  _hasObject?: boolean;
  _fieldPath?: string;
  _realId?: string;
}

export interface KanectaItemWithChildren extends KanectaItem {
  children: KanectaItemWithChildren[];
}

export interface Annotation {
  id: string;
  itemId: string;
  parentAnnotationId?: string;
  value: string;
  createdAt: string;
  modifiedAt: string;
  replies?: Annotation[];
}

export interface Relationship {
  id: string;
  fromId: string;
  toId: string;
  type: RelationshipType;
  createdAt: string;
}

export interface HistoryEntry {
  id: string;
  itemId: string;
  operation: 'create' | 'update' | 'delete';
  snapshot: Partial<KanectaItem>;
  timestamp: string;
}

export interface Alias {
  alias: string;
  itemId: string;
}

export interface ListResponse<T> {
  items: T[];
  total?: number;
}

export interface CreateItemPayload {
  value: string;
  type: ItemType;
  typeId?: string;
  confidence?: Confidence;
  parentId?: string;
  sortOrder?: number;
  tags?: string[];
  license?: string;
}

export interface UpdateItemPayload {
  value?: string;
  type?: ItemType;
  typeId?: string;
  confidence?: Confidence | null;
  parentId?: string;
  sortOrder?: number;
  tags?: string[];
  license?: string;
}

export interface CreateAnnotationPayload {
  value: string;
  parentAnnotationId?: string;
}

export interface CreateRelationshipPayload {
  fromId: string;
  toId: string;
  type: RelationshipType;
}

export interface ApiError {
  error: string;
}
