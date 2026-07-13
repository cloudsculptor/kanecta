// ─── Shared types ────────────────────────────────────────────────────────────

export interface KanectaItemCore {
  id: string;
  parentId?: string | null;
  type: string;
  typeId?: string | null;
  value?: string | null;
  sortOrder?: number | null;
  aspect?: string | null;
}

export interface KanectaItemMeta {
  specVersion?: string;
  owner?: string | null;
  license?: string | null;
  visibility?: string;
  confidence?: string | null;
  status?: string | null;
  tags?: string[];
  createdAt: string;
  modifiedAt: string;
  createdBy?: string | null;
  modifiedBy?: string | null;
  completedAt?: string | null;
  dueAt?: string | null;
  expiresAt?: string | null;
  deletedAt?: string | null;
  cachedAt?: string | null;
  connectorId?: string | null;
  materialized?: boolean | null;
  files?: Record<string, unknown>;
  layer?: string | null;
  sourceSystem?: string | null;
  sourceExternalId?: string | null;
  icon?: string | null;
}

export interface KanectaItemDocument {
  item: KanectaItemCore;
  meta: KanectaItemMeta;
  payload: Record<string, unknown> | null;
  time: Record<string, unknown> | null;
  // Tree enrichment fields added by the API
  childCount?: number;
  _hasObject?: boolean;
  _synthetic?: boolean;
}

// The flat read model returned by the API/lib/MCP: item + meta fields promoted
// to the top level, a derived `icon` slug always present, and the object data
// kept boxed under `payload` (so payload field names never clash with basics).
export interface KanectaItem {
  id: string;
  specVersion?: string;
  value?: string | null;
  type: string;
  typeId?: string | null;
  parentId?: string | null;
  icon: string;
  owner?: string | null;
  license?: string | null;
  visibility?: string;
  aspect?: string | null;
  sortOrder?: number | null;
  confidence?: string | null;
  status?: string | null;
  tags?: string[];
  createdAt: string;
  modifiedAt?: string;
  /** @deprecated the flat model uses `modifiedAt`; kept for back-compat */
  updatedAt?: string;
  createdBy?: string | null;
  modifiedBy?: string | null;
  completedAt?: string | null;
  dueAt?: string | null;
  expiresAt?: string | null;
  deletedAt?: string | null;
  cachedAt?: string | null;
  connectorId?: string | null;
  materialized?: boolean | null;
  layer?: string | null;
  sourceSystem?: string | null;
  sourceExternalId?: string | null;
  files?: Record<string, unknown>;
  /** object data, present only for items that have a payload section */
  payload?: Record<string, unknown> | null;
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
  /** Count of items whose `value` exceeds the spec maximum length (255 chars). */
  overLongValues?: number;
}

export interface BulkCreateResult {
  created: KanectaItem[];
  errors: Array<{ index: number; error: string }>;
}

export interface BulkUpdateResult {
  updated: KanectaItem[];
  errors: Array<{ index: number; id?: string; error: string }>;
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
  getTime(id: string): Promise<Record<string, unknown>>;
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

export type DocumentMode = 'document' | 'tree' | 'todo';

// Type alias (not interface) so it is assignable to KanectaItem's
// `Record<string, unknown>` payload, letting DocumentItem narrow it below.
export type DocumentPayload = {
  targetId: string;
  name: string;
  mode?: DocumentMode;
  expandState?: { defaultDepth?: number; exceptions?: Record<string, number | false> };
  roleMap?: { byDepth?: Record<string, string>; byType?: Record<string, string> };
  isOrgDefault?: boolean;
  baseDocumentId?: string | null;
};

export interface DocumentItem extends KanectaItem {
  payload?: DocumentPayload | null;
}

export interface CreateDocumentPayload {
  name: string;
  mode?: DocumentMode;
  expandState?: DocumentPayload['expandState'];
  roleMap?: DocumentPayload['roleMap'];
  isOrgDefault?: boolean;
  visibility?: string;
  baseDocumentId?: string | null;
  actor?: string;
}

export interface DocumentsApi {
  listForTarget(targetId: string): Promise<DocumentItem[]>;
  create(targetId: string, payload: CreateDocumentPayload): Promise<DocumentItem>;
  get(docId: string): Promise<DocumentPayload>;
  update(docId: string, payload: DocumentPayload): Promise<{ ok: boolean }>;
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
  schema(id: string): Promise<TypeSchema>;
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

// ─── Integrity check ──────────────────────────────────────────────────────────

export type IntegrityStatus = 'pass' | 'fail' | 'skip';

export interface IntegrityFinding {
  severity: 'error' | 'warn';
  message: string;
  nodeId?: string;
  fix?: string;
  [extra: string]: unknown;
}

export interface IntegrityCheckResult {
  id: string;
  title: string;
  group: string;
  specRef: string;
  status: IntegrityStatus;
  findings: IntegrityFinding[];
  count: number;
  skipped?: string;
}

export interface IntegritySummary {
  total: number;
  passed: number;
  failed: number;
  skipped: number;
  errorCount: number;
  warnCount: number;
  ok: boolean;
}

export interface IntegrityReport {
  checks: IntegrityCheckResult[];
  summary: IntegritySummary;
}

/** Progressive SSE events from the streaming endpoint. */
export type IntegrityEvent =
  | { type: 'manifest'; total: number; checks: Array<Pick<IntegrityCheckResult, 'id' | 'title' | 'group' | 'specRef'>> }
  | { type: 'result'; index: number; result: IntegrityCheckResult }
  | { type: 'done'; summary: IntegritySummary }
  | { type: 'error'; error: string };

export interface IntegrityQuery {
  checks?: string[];
  groups?: string[];
}

export interface IntegrityApi {
  /** Run the full check and return the collected report. */
  report(query?: IntegrityQuery): Promise<IntegrityReport>;
  /** URL suitable for `new EventSource(url)` — streams IntegrityEvent SSE. */
  streamUrl(query?: IntegrityQuery): string;
  /** Raw fetch Response with an event-stream body (carries the auth header). */
  stream(query?: IntegrityQuery): Promise<Response>;
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

// ─── Client config ────────────────────────────────────────────────────────────

// A static token, or a (possibly async) getter for the current token —
// needed for deployments where it's refreshed in place (e.g. Keycloak).
export type ApiClientToken = string | (() => string | null | undefined | Promise<string | null | undefined>);

export interface ApiClientOptions {
  baseUrl?: string;
  token?: ApiClientToken;
}

// ─── Errors ──────────────────────────────────────────────────────────────────

export class ApiError extends Error {
  status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
  }
}

// ─── Main client ─────────────────────────────────────────────────────────────

export class KanectaApiClient {
  private _base: string;
  private _token?: ApiClientToken;

  // `token` may be a static string, or a (possibly async) function returning
  // the current token — needed for Keycloak-backed deployments, where the
  // access token expires and is refreshed in place behind the scenes.
  constructor(baseUrl: string, token?: ApiClientToken) {
    this._base = baseUrl.replace(/\/$/, '');
    this._token = token;
  }

  private async _resolveToken(): Promise<string | null | undefined> {
    return typeof this._token === 'function' ? await this._token() : this._token;
  }

  private async _fetch(method: string, path: string, body?: unknown): Promise<any> {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    const token = await this._resolveToken();
    if (token) headers['Authorization'] = `Bearer ${token}`;
    const res = await fetch(`${this._base}${path}`, {
      method,
      headers,
      body: body != null ? JSON.stringify(body) : undefined,
    });
    const responseBody: any = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw new ApiError(res.status, responseBody.error ?? res.statusText);
    }
    return responseBody;
  }

  // ─── Config / system ────────────────────────────────────────────────────────

  get config(): ConfigApi {
    const c = this;
    return {
      get: () => c._fetch('GET', '/config'),
      openInVSCode: (path) => c._fetch('POST', '/open-in-vscode', { path }),
      openPath: (path) => c._fetch('POST', '/open-path', { path }),
      openInBrowser: (path) => c._fetch('POST', '/open-in-browser', { path }),
    };
  }

  // ─── Search ─────────────────────────────────────────────────────────────────

  search(q: string, options: SearchOptions = {}): Promise<SearchResult> {
    const params = new URLSearchParams({ q });
    if (options.rootId) params.set('rootId', options.rootId);
    if (options.limit != null) params.set('limit', String(options.limit));
    if (options.fields != null) {
      params.set('fields', Array.isArray(options.fields) ? options.fields.join(',') : options.fields);
    }
    return this._fetch('GET', `/search?${params}`);
  }

  // ─── Items ──────────────────────────────────────────────────────────────────

  get items(): ItemsApi {
    const c = this;
    return {
      list: () => c._fetch('GET', '/items'),
      root: () => c._fetch('GET', '/items/root'),
      stats: () => c._fetch('GET', '/items/stats'),
      get: (id) => c._fetch('GET', `/items/${id}`),
      create: (payload) => c._fetch('POST', '/items', payload),
      bulkCreate: (items) => c._fetch('POST', '/items/bulk', { items }),
      update: (id, payload) => c._fetch('PUT', `/items/${id}`, payload),
      bulkUpdate: (updates) => c._fetch('PATCH', '/items/bulk', { updates }),
      delete: (id, force = false) => c._fetch('DELETE', `/items/${id}${force ? '?force=true' : ''}`),
      children: (id) => c._fetch('GET', `/items/${id}/children`),
      tree: (id, depth) =>
        c._fetch('GET', `/items/${id}/tree${depth != null ? `?depth=${depth}` : ''}`),
      ancestors: (id) => c._fetch('GET', `/items/${id}/ancestors`),
      clone: (id, payload) => c._fetch('POST', `/items/${id}/clone`, payload),
      annotations: (id) => c._fetch('GET', `/items/${id}/annotations`),
      annotate: (id, payload) => c._fetch('POST', `/items/${id}/annotations`, payload),
      relationships: (id) => c._fetch('GET', `/items/${id}/relationships`),
      backlinks: (id) => c._fetch('GET', `/items/${id}/backlinks`),
      history: (id) => c._fetch('GET', `/items/${id}/history`),
      getObject: (id) => c._fetch('GET', `/items/${id}/object`),
      saveObject: (id, data) => c._fetch('PUT', `/items/${id}/object`, data),
      getTime: (id) => c._fetch('GET', `/items/${id}/time`),
      complete: (id, actor) => c._fetch('POST', `/items/${id}/complete`, actor ? { actor } : {}),
      uncomplete: (id, actor) => c._fetch('POST', `/items/${id}/uncomplete`, actor ? { actor } : {}),
      getFunction: (id) => c._fetch('GET', `/items/${id}/function`),
      saveFunction: (id, payload) => c._fetch('PUT', `/items/${id}/function`, payload),
      getFunctionPackageJson: (id) => c._fetch('GET', `/items/${id}/function/package-json`),
      getFunctionScaffold: (id) => c._fetch('GET', `/items/${id}/function/scaffold`),
      compileFunction: (id) => c._fetch('POST', `/items/${id}/function/compile`, {}),
      runFunction: (id, args = {}) => c._fetch('POST', `/items/${id}/function/run`, { args }),
    };
  }

  // ─── Tree ────────────────────────────────────────────────────────────────────

  get tree(): TreeApi {
    const c = this;
    return {
      get: (depth) => c._fetch('GET', `/tree${depth != null ? `?depth=${depth}` : ''}`),
    };
  }

  // ─── Documents (saved subtree projections) ───────────────────────────────────

  get documents(): DocumentsApi {
    const c = this;
    return {
      listForTarget: (targetId) => c._fetch('GET', `/items/${targetId}/documents`),
      create: (targetId, payload) => c._fetch('POST', `/items/${targetId}/documents`, payload),
      get: (docId) => c._fetch('GET', `/documents/${docId}`),
      update: (docId, payload) => c._fetch('PUT', `/documents/${docId}`, payload),
    };
  }

  // ─── Aliases ─────────────────────────────────────────────────────────────────

  get aliases(): AliasesApi {
    const c = this;
    return {
      list: (targetId) =>
        c._fetch('GET', `/aliases${targetId ? `?targetId=${encodeURIComponent(targetId)}` : ''}`),
      resolve: (alias) => c._fetch('GET', `/aliases/${encodeURIComponent(alias)}`),
      set: (alias, targetId) => c._fetch('POST', '/aliases', { alias, targetId }),
      remove: (alias) => c._fetch('DELETE', `/aliases/${encodeURIComponent(alias)}`),
    };
  }

  // ─── Relationships ───────────────────────────────────────────────────────────

  get relationships(): RelationshipsApi {
    const c = this;
    return {
      list: () => c._fetch('GET', '/relationships'),
      create: (payload) => c._fetch('POST', '/relationships', payload),
    };
  }

  // ─── Tags ────────────────────────────────────────────────────────────────────

  get tags(): TagsApi {
    const c = this;
    return {
      byTag: (tag) => c._fetch('GET', `/tags/${encodeURIComponent(tag)}`),
    };
  }

  // ─── Types ───────────────────────────────────────────────────────────────────

  get types(): TypesApi {
    const c = this;
    return {
      list: () => c._fetch('GET', '/types'),
      create: (value) => c._fetch('POST', '/types', { value }),
      get: (id) => c._fetch('GET', `/types/${id}`),
      schema: (id) => c._fetch('GET', `/types/${id}/schema`),
      getSchema: (id) => c._fetch('GET', `/types/${id}/schema`),
      updateSchema: (id, schema) => c._fetch('PUT', `/types/${id}/schema`, schema),
    };
  }

  // ─── Breadcrumb / history ────────────────────────────────────────────────────

  get breadcrumb(): BreadcrumbApi {
    const c = this;
    return {
      getClipboard: () => c._fetch('GET', '/breadcrumb/clipboard'),
      addClipboard: (payload) => c._fetch('POST', '/breadcrumb/clipboard', payload),
      getViewed: () => c._fetch('GET', '/breadcrumb/viewed'),
      addViewed: (payload) => c._fetch('POST', '/breadcrumb/viewed', payload),
    };
  }

  // ─── Starred ─────────────────────────────────────────────────────────────────

  get starred(): StarredApi {
    const c = this;
    return {
      get: () => c._fetch('GET', '/app/studio/starred'),
      add: (payload) => c._fetch('POST', '/app/studio/starred', payload),
      remove: (id) => c._fetch('DELETE', `/app/studio/starred/${id}`),
    };
  }

  // ─── View ────────────────────────────────────────────────────────────────────

  get view(): ViewApi {
    const c = this;
    return {
      get: (id) => c._fetch('GET', `/app/studio/view/${id}`),
      save: (id, payload) => c._fetch('PUT', `/app/studio/view/${id}`, payload),
    };
  }

  // ─── Settings ────────────────────────────────────────────────────────────────

  get settings(): SettingsApi {
    const c = this;
    return {
      get: () => c._fetch('GET', '/app/studio/settings'),
      save: (payload) => c._fetch('POST', '/app/studio/settings', payload),
    };
  }

  // ─── Layouts ─────────────────────────────────────────────────────────────────

  get layouts(): LayoutsApi {
    const c = this;
    return {
      get: () => c._fetch('GET', '/app/studio/layouts'),
      save: (payload) => c._fetch('PUT', '/app/studio/layouts', payload),
    };
  }

  // ─── Skills ──────────────────────────────────────────────────────────────────

  get skills(): SkillsApi {
    const c = this;
    return {
      list: () => c._fetch('GET', '/skills'),
      get: (id) => c._fetch('GET', `/skills/${id}`),
      update: (id, content) => c._fetch('PUT', `/skills/${id}`, { content }),
    };
  }

  // ─── Indexes ─────────────────────────────────────────────────────────────────

  rebuildIndexes(): Promise<{ rebuilt: boolean; itemCount: number }> {
    return this._fetch('POST', '/rebuild-indexes', {});
  }

  // ─── Claude sessions ─────────────────────────────────────────────────────────

  get claude(): ClaudeApi {
    const c = this;
    return {
      createSession: (prompt, workingDir) =>
        c._fetch('POST', '/claude/sessions', { prompt, workingDir }),
      // URL suitable for `new EventSource(url)`
      streamUrl: (id) => `${c._base}/claude/sessions/${id}/stream`,
      // Returns a raw fetch Response with an event-stream body
      streamSession: async (id) => {
        const headers: Record<string, string> = { Accept: 'text/event-stream' };
        const token = await c._resolveToken();
        if (token) headers['Authorization'] = `Bearer ${token}`;
        return fetch(`${c._base}/claude/sessions/${id}/stream`, { headers });
      },
      respond: (id, approved) =>
        c._fetch('POST', `/claude/sessions/${id}/respond`, { approved }),
      cancelSession: (id) => c._fetch('DELETE', `/claude/sessions/${id}`),
    };
  }

  // ─── Integrity check ─────────────────────────────────────────────────────────

  get integrity(): IntegrityApi {
    const c = this;
    const qs = (query?: IntegrityQuery) => {
      const p = new URLSearchParams();
      if (query?.checks?.length) p.set('checks', query.checks.join(','));
      if (query?.groups?.length) p.set('groups', query.groups.join(','));
      const s = p.toString();
      return s ? `?${s}` : '';
    };
    return {
      report: (query) => c._fetch('GET', `/integrity${qs(query)}`),
      streamUrl: (query) => `${c._base}/integrity/stream${qs(query)}`,
      stream: async (query) => {
        const headers: Record<string, string> = { Accept: 'text/event-stream' };
        const token = await c._resolveToken();
        if (token) headers['Authorization'] = `Bearer ${token}`;
        return fetch(`${c._base}/integrity/stream${qs(query)}`, { headers });
      },
    };
  }

  // ─── Working sets ────────────────────────────────────────────────────────────

  get workingSets(): WorkingSetsApi {
    const c = this;
    return {
      list: () => c._fetch('GET', '/working-sets'),
      createBranch: (workspaceName, branchName) =>
        c._fetch('POST', `/working-sets/${encodeURIComponent(workspaceName)}/branches`, { branchName }),
      switchBranch: (workspaceName, branch) =>
        c._fetch('POST', `/working-sets/${encodeURIComponent(workspaceName)}/branches/${encodeURIComponent(branch)}/switch`),
    };
  }
}

/**
 * Create a Kanecta API client.
 *
 * Reads KANECTA_API_URL (default http://localhost:3001) and KANECTA_TOKEN
 * from the environment unless overridden via options. `options.token` may
 * also be a (possibly async) function returning the current token, for
 * deployments where it's refreshed in place (e.g. Keycloak).
 */
export function createApiClient(options: ApiClientOptions = {}): KanectaApiClient {
  const env = typeof process !== 'undefined' && process.env ? process.env : {};
  const baseUrl = options.baseUrl ?? env.KANECTA_API_URL ?? 'http://localhost:3001';
  const token = options.token ?? env.KANECTA_TOKEN;
  return new KanectaApiClient(baseUrl, token);
}
