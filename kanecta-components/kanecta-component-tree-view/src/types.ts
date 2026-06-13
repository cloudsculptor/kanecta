export interface KanectaItem {
  id: string;
  value: string;
  type: string;
  typeId?: string | null;
  confidence?: string | null;
  parentId?: string | null;
  sortOrder: number;
  tags: string[];
  icon?: string | null;
  status?: string | null;
  createdAt: string | null;
  modifiedAt: string | null;
  childCount?: number;
  _synthetic?: boolean;
  _hasObject?: boolean;
  _fieldPath?: string;
  _realId?: string;
}

export interface KanectaItemWithChildren extends KanectaItem {
  children: KanectaItemWithChildren[];
}

export interface CreateItemPayload {
  value: string;
  type: string;
  parentId?: string;
}

export interface UpdateItemPayload {
  value?: string;
  type?: string;
  parentId?: string;
}

export interface TreeEntry {
  item: KanectaItem;
  depth: number;
}

export interface StarredEntry {
  id: string;
  name: string;
  type: string;
  typeId: string;
}

export interface AliasEntry {
  alias: string;
  targetId: string;
}

export interface ViewSettings {
  levels?: number | 'all';
}

export interface FunctionScaffoldStatus {
  exists: boolean;
  stale: boolean;
}

export interface FunctionRunResult {
  success: boolean;
  output: string | null;
  logs: string;
}

export interface FunctionCompileResult {
  success: boolean;
  output: string;
}

export interface TreeViewApi {
  items: {
    list(): Promise<KanectaItem[]>;
    root(): Promise<KanectaItem>;
    get(id: string): Promise<KanectaItem>;
    children(id: string): Promise<KanectaItem[]>;
    tree(id: string, maxDepth?: number): Promise<TreeEntry[]>;
    create(payload: CreateItemPayload): Promise<KanectaItem>;
    update(id: string, payload: UpdateItemPayload): Promise<KanectaItem>;
    delete(id: string, recursive?: boolean): Promise<{ deleted: string }>;
    getObject(id: string): Promise<unknown>;
    getFunctionData(id: string): Promise<Record<string, unknown> | null>;
    saveFunctionData(id: string, data: Record<string, unknown>): Promise<{ ok: boolean }>;
    checkFunctionScaffold(id: string): Promise<FunctionScaffoldStatus>;
    compileFunctionScaffold(id: string): Promise<FunctionCompileResult>;
    runFunctionScaffold(id: string, args: Record<string, string>): Promise<FunctionRunResult>;
    getFunctionPackageJson(id: string): Promise<unknown>;
  };
  aliases: {
    list(): Promise<AliasEntry[]>;
    listForItem(id: string): Promise<AliasEntry[]>;
    resolve(alias: string): Promise<AliasEntry>;
    set(alias: string, targetId: string): Promise<AliasEntry>;
    remove(alias: string): Promise<{ removed: string }>;
  };
  config: {
    get(): Promise<{ datastorePath: string; vscodeAvailable: boolean }>;
    openPath(path: string): Promise<{ ok: boolean }>;
    openInBrowser(path: string): Promise<{ ok: boolean }>;
    openInVscode(path: string): Promise<{ ok: boolean }>;
  };
  breadcrumb: {
    addClipboard(id: string, name: string, type: string, typeId: string): Promise<{ ok: boolean }>;
    addViewed(id: string, name: string, type: string, typeId: string): Promise<{ ok: boolean }>;
  };
  starred: {
    list(): Promise<StarredEntry[]>;
    add(id: string, name: string, type: string, typeId: string): Promise<{ ok: boolean }>;
    remove(id: string): Promise<{ ok: boolean }>;
  };
  view: {
    get(id: string): Promise<ViewSettings | null>;
    save(id: string, levels: number | 'all'): Promise<{ ok: boolean }>;
  };
  types: {
    schema(typeId: string): Promise<unknown>;
  };
  tree: {
    full(depth?: number): Promise<KanectaItemWithChildren[]>;
  };
}
