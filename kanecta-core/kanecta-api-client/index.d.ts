// ─── Shared types ────────────────────────────────────────────────────────────

export interface KanectaItem {
  id: string;
  value?: string | null;
  type: string;
  typeId?: string | null;
  parentId?: string | null;
  owner?: string | null;
  license?: string | null;
  sortOrder?: number | null;
  confidence?: string | null;
  status?: string | null;
  tags?: string[];
  completedAt?: string | null;
  createdAt: string;
  updatedAt: string;
  childCount?: number;
  _hasObject?: boolean;
  _synthetic?: boolean;
}

export interface Annotation {
  id: string;
  itemId: string;
  content: string;
  author?: string | null;
  parentAnnotationId?: string | null;
  createdAt: string;
}

export interface Relationship {
  id: string;
  sourceId: string;
  type: string;
  targetId: string;
  note?: string | null;
  createdBy?: string | null;
  createdAt: string;
}

export interface HistoryEntry {
  at: string;
  field: string;
  from?: unknown;
  to?: unknown;
}

export interface TypeMetadata {
  id: string;
  value: string;
  type: string;
  icon?: string | null;
  description?: string | null;
  details?: string | null;
  keywords?: string | null;
  tags?: string | null;
  primaryField?: string | null;
  'ai-instructions'?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface TypeSchema {
  meta: {
    name: string;
    icon?: string | null;
    description?: string | null;
    details?: string | null;
    keywords?: string | null;
    primaryField?: string | null;
    'ai-instructions'?: string | null;
  };
  jsonSchema: {
    $schema: string;
    type: 'object';
    title: string;
    properties: Record<string, unknown>;
    required?: string[];
  };
}

export interface AliasEntry {
  alias: string;
  targetId: string;
}

export interface BreadcrumbEntry {
  id: string;
  name: string;
  type: string;
  typeId: string;
  timestamp: string;
}

export interface StarredEntry {
  id: string;
  name: string;
  type: string;
  typeId: string;
  timestamp: string;
}

export interface StudioSettings {
  themeName: string;
  sidebarBg: string;
  sidebarFg: string;
  sidebarFgSelected: string;
  contentBg: string;
  contentBorder: string;
  showContentBorder: boolean;
  locationBorder: string;
}

export interface LayoutData {
  activeTabId: string;
  tabs: Array<{
    id: string;
    label: string;
    root: unknown;
  }>;
}

export interface Skill {
  id: string;
  title: string;
  filename: string;
  content?: string;
}

export interface FunctionDefinition {
  description?: string;
  parameters?: Array<{
    name: string;
    type: string;
    description?: string;
    required?: boolean;
    default?: unknown;
  }>;
  [key: string]: unknown;
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

export interface ClaudeSession {
  id: string;
}

export interface ApprovalNeededEvent {
  type: 'approval_needed';
  toolName: string;
  toolInput: Record<string, unknown>;
  toolUseId: string;
}

export interface ToolRanEvent {
  type: 'tool_ran';
  toolName: string;
  toolInput: Record<string, unknown>;
  toolUseId: string;
}

export interface RawEvent {
  type: 'raw';
  event: Record<string, unknown>;
}

export interface DoneEvent {
  type: 'done';
  result?: string;
  code?: number | null;
}

export interface StderrEvent {
  type: 'stderr';
  text: string;
}

export interface ApprovalResolvedEvent {
  type: 'approval_resolved';
  approved: boolean;
}

export type ClaudeEvent =
  | ApprovalNeededEvent
  | ToolRanEvent
  | RawEvent
  | DoneEvent
  | StderrEvent
  | ApprovalResolvedEvent;

export interface ConfigResponse {
  datastorePath: string;
  vscodeAvailable: boolean;
}

export interface SearchResult {
  query: string;
  count: number;
  results: Array<KanectaItem & { ancestors: Array<{ id: string; value: string; type: string }> }>;
}

export interface ItemStats {
  total: number;
  typedCount: number;
  structured: Array<{ typeId: string; name: string; icon: string | null; count: number }>;
  unstructured: Array<{ type: string; count: number }>;
}

export interface BulkCreateResult {
  created: KanectaItem[];
  errors: Array<{ index: number; error: string }>;
}

export interface BulkUpdateResult {
  updated: KanectaItem[];
  errors: Array<{ index: number; id?: string; error: string }>;
}

export interface SyncSystemItem {
  folderId: string;
  title: string;
  schema: TypeSchema;
}

// ─── Namespace interfaces ─────────────────────────────────────────────────────

export interface ConfigApi {
  get(): Promise<ConfigResponse>;
  openInVSCode(path: string): Promise<{ ok: boolean }>;
  openPath(path: string): Promise<{ ok: boolean }>;
  openInBrowser(path: string): Promise<{ ok: boolean }>;
}

export interface SearchOptions {
  rootId?: string;
  limit?: number;
  fields?: string | string[];
}

export interface CreateItemPayload {
  parentId?: string | null;
  value?: string | null;
  type?: string;
  typeId?: string | null;
  owner?: string;
  license?: string | null;
  sortOrder?: number;
  confidence?: string | null;
  status?: string | null;
  tags?: string[];
  alias?: string;
  createdBy?: string;
  objectData?: Record<string, unknown> | null;
}

export interface UpdateItemPayload {
  value?: string | null;
  type?: string;
  typeId?: string | null;
  parentId?: string | null;
  sortOrder?: number;
  confidence?: string | null;
  license?: string | null;
  status?: string | null;
  tags?: string[];
  completedAt?: string | null;
  actor?: string;
  objectData?: Record<string, unknown> | null;
}

export interface CloneItemPayload {
  targetParentId: string;
  actor?: string;
}

export interface CreateAnnotationPayload {
  content: string;
  author?: string;
  parentAnnotationId?: string | null;
}

export interface ItemsApi {
  list(): Promise<KanectaItem[]>;
  root(): Promise<KanectaItem>;
  stats(): Promise<ItemStats>;
  get(id: string): Promise<KanectaItem>;
  create(payload: CreateItemPayload): Promise<KanectaItem>;
  bulkCreate(items: CreateItemPayload[]): Promise<BulkCreateResult>;
  update(id: string, payload: UpdateItemPayload): Promise<KanectaItem>;
  bulkUpdate(updates: Array<{ id: string } & UpdateItemPayload>): Promise<BulkUpdateResult>;
  delete(id: string, force?: boolean): Promise<{ deleted: string[] }>;
  children(id: string): Promise<KanectaItem[]>;
  tree(id: string, depth?: number): Promise<unknown>;
  ancestors(id: string): Promise<Array<{ id: string; value: string; type: string }>>;
  clone(id: string, payload: CloneItemPayload): Promise<KanectaItem>;
  annotations(id: string): Promise<Annotation[]>;
  annotate(id: string, payload: CreateAnnotationPayload): Promise<Annotation>;
  relationships(id: string): Promise<Relationship[]>;
  backlinks(id: string): Promise<KanectaItem[]>;
  history(id: string): Promise<HistoryEntry[]>;
  getObject(id: string): Promise<Record<string, unknown>>;
  saveObject(id: string, data: Record<string, unknown>): Promise<{ ok: boolean }>;
  complete(id: string, actor?: string): Promise<KanectaItem>;
  uncomplete(id: string, actor?: string): Promise<KanectaItem>;
  getFunction(id: string): Promise<FunctionDefinition>;
  saveFunction(id: string, payload: FunctionDefinition): Promise<{ ok: boolean }>;
  getFunctionPackageJson(id: string): Promise<Record<string, unknown> | null>;
  getFunctionScaffold(id: string): Promise<FunctionScaffoldStatus>;
  compileFunction(id: string): Promise<{ success: boolean; output: string }>;
  runFunction(id: string, args?: Record<string, unknown>): Promise<FunctionRunResult>;
}

export interface TreeApi {
  get(depth?: number): Promise<unknown>;
}

export interface AliasesApi {
  list(targetId?: string): Promise<AliasEntry[]>;
  resolve(alias: string): Promise<AliasEntry>;
  set(alias: string, targetId: string): Promise<AliasEntry>;
  remove(alias: string): Promise<{ removed: string }>;
}

export interface CreateRelationshipPayload {
  sourceId: string;
  type: string;
  targetId: string;
  note?: string | null;
  createdBy?: string;
}

export interface RelationshipsApi {
  list(): Promise<Relationship[]>;
  create(payload: CreateRelationshipPayload): Promise<Relationship>;
}

export interface TagsApi {
  byTag(tag: string): Promise<KanectaItem[]>;
}

export interface TypesApi {
  list(): Promise<TypeMetadata[]>;
  create(value: string): Promise<TypeMetadata>;
  get(id: string): Promise<TypeMetadata>;
  getSchema(id: string): Promise<TypeSchema>;
  updateSchema(id: string, schema: TypeSchema): Promise<TypeSchema>;
}

export interface BreadcrumbPayload {
  id: string;
  name: string;
  type?: string;
  typeId?: string;
}

export interface BreadcrumbApi {
  getClipboard(): Promise<BreadcrumbEntry[]>;
  addClipboard(payload: BreadcrumbPayload): Promise<{ ok: boolean }>;
  getViewed(): Promise<BreadcrumbEntry[]>;
  addViewed(payload: BreadcrumbPayload): Promise<{ ok: boolean }>;
}

export interface StarredPayload {
  id: string;
  name: string;
  type?: string;
  typeId?: string;
}

export interface StarredApi {
  get(): Promise<StarredEntry[]>;
  add(payload: StarredPayload): Promise<{ ok: boolean }>;
  remove(id: string): Promise<{ ok: boolean }>;
}

export interface ViewApi {
  get(id: string): Promise<Record<string, unknown> | null>;
  save(id: string, payload: { levels: unknown }): Promise<{ ok: boolean }>;
}

export interface SystemItemsApi {
  getSync(): Promise<SyncSystemItem[]>;
  import(folderIds: string[]): Promise<{ imported: Array<{ id: string; value: string }>; errors: Array<{ folderId: string; error: string }> }>;
  export(typeIds: string[]): Promise<{ exported: Array<{ id: string }>; errors: Array<{ id: string; error: string }> }>;
}

export interface SettingsApi {
  get(): Promise<StudioSettings>;
  save(payload: Partial<StudioSettings> & { themeName: string }): Promise<{ ok: boolean }>;
}

export interface LayoutsApi {
  get(): Promise<LayoutData>;
  save(payload: LayoutData): Promise<{ ok: boolean }>;
}

export interface SkillsApi {
  list(): Promise<Skill[]>;
  get(id: string): Promise<Skill>;
  update(id: string, content: string): Promise<Skill>;
}

export interface ClaudeApi {
  createSession(prompt: string, workingDir?: string): Promise<ClaudeSession>;
  /** URL suitable for `new EventSource(url)` */
  streamUrl(id: string): string;
  /** Returns a raw fetch Response with Content-Type: text/event-stream */
  streamSession(id: string): Promise<Response>;
  respond(id: string, approved: boolean): Promise<{ ok: boolean }>;
  cancelSession(id: string): Promise<{ ok: boolean }>;
}

// ─── Errors ──────────────────────────────────────────────────────────────────

export declare class ApiError extends Error {
  status: number;
  constructor(status: number, message: string);
}

// ─── Main client ─────────────────────────────────────────────────────────────

// A static token, or a (possibly async) getter for the current token —
// needed for deployments where it's refreshed in place (e.g. Keycloak).
export type ApiClientToken = string | (() => string | null | undefined | Promise<string | null | undefined>);

export interface ApiClientOptions {
  baseUrl?: string;
  token?: ApiClientToken;
}

export declare class KanectaApiClient {
  constructor(baseUrl: string, token?: ApiClientToken);
  readonly config: ConfigApi;
  readonly items: ItemsApi;
  readonly tree: TreeApi;
  readonly aliases: AliasesApi;
  readonly relationships: RelationshipsApi;
  readonly tags: TagsApi;
  readonly types: TypesApi;
  readonly breadcrumb: BreadcrumbApi;
  readonly starred: StarredApi;
  readonly view: ViewApi;
  readonly systemItems: SystemItemsApi;
  readonly settings: SettingsApi;
  readonly layouts: LayoutsApi;
  readonly skills: SkillsApi;
  readonly claude: ClaudeApi;
  readonly workingSets: WorkingSetsApi;
  search(q: string, options?: SearchOptions): Promise<SearchResult>;
  rebuildIndexes(): Promise<{ rebuilt: boolean; itemCount: number }>;
}

export interface WorkingSetBranch {
  name: string;
  active: boolean;
  baseBranch: string | null;
}

export interface WorkingSetRemote {
  type: string;
  host?: string;
  port?: number;
  database?: string;
  [key: string]: unknown;
}

export interface WorkingSet {
  name: string;
  local: { path: string; ok: boolean } | null;
  remotes: Record<string, WorkingSetRemote>;
  branch: string;
  branches: WorkingSetBranch[];
  isActive: boolean;
}

export interface WorkingSetsApi {
  list(): Promise<{ workingSets: WorkingSet[]; activeWorkspace: string }>;
  createBranch(workspaceName: string, branchName: string): Promise<{ ok: boolean; branch: WorkingSetBranch }>;
  switchBranch(workspaceName: string, branch: string): Promise<{ ok: boolean; branch: string }>;
}

export declare function createApiClient(options?: ApiClientOptions): KanectaApiClient;
