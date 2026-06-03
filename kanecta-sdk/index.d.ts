export interface KanectaItem {
  id: string;
  value?: string;
  typeId?: string;
  parentId?: string;
  createdAt: string;
  updatedAt: string;
}

export interface CreateItemPayload {
  value?: string;
  typeId?: string;
  parentId?: string;
}

export interface UpdateItemPayload {
  value?: string;
  typeId?: string;
  parentId?: string;
}

export interface Annotation {
  id: string;
  itemId: string;
  content: string;
  createdAt: string;
}

export interface CreateAnnotationPayload {
  content: string;
}

export interface Relationship {
  id: string;
  fromId: string;
  toId: string;
  label?: string;
}

export interface HistoryEntry {
  at: string;
  value?: string;
}

export interface ClientOptions {
  baseUrl?: string;
  token?: string;
}

export interface ItemsApi {
  list(): Promise<KanectaItem[]>;
  root(): Promise<KanectaItem>;
  get(id: string): Promise<KanectaItem>;
  create(payload: CreateItemPayload): Promise<KanectaItem>;
  update(id: string, payload: UpdateItemPayload): Promise<KanectaItem>;
  delete(id: string, force?: boolean): Promise<{ deleted: string }>;
  children(id: string): Promise<KanectaItem[]>;
  tree(id: string, depth?: number): Promise<Array<{ item: KanectaItem; depth: number }>>;
  annotations(id: string): Promise<Annotation[]>;
  annotate(id: string, payload: CreateAnnotationPayload): Promise<Annotation>;
  relationships(id: string): Promise<Relationship[]>;
  backlinks(id: string): Promise<KanectaItem[]>;
  history(id: string): Promise<HistoryEntry[]>;
  getObject(id: string): Promise<Record<string, unknown>>;
  saveObject(id: string, data: Record<string, unknown>): Promise<{ ok: boolean }>;
}

export declare class KanectaClient {
  constructor(baseUrl: string, token?: string);
  readonly items: ItemsApi;
}

export declare function createClient(options?: ClientOptions): KanectaClient;
