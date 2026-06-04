import type { KanectaApiClient, ApiClientOptions, KanectaItem, CreateItemPayload } from '@kanecta/api-client';

export {
  // Types
  KanectaItem,
  Annotation,
  Relationship,
  HistoryEntry,
  TypeMetadata,
  TypeSchema,
  AliasEntry,
  BreadcrumbEntry,
  StarredEntry,
  StudioSettings,
  LayoutData,
  Skill,
  FunctionDefinition,
  FunctionScaffoldStatus,
  FunctionRunResult,
  ClauseSession,
  ConfigResponse,
  SearchResult,
  SearchOptions,
  ItemStats,
  BulkCreateResult,
  BulkUpdateResult,
  SyncSystemItem,
  // Payload types
  CreateItemPayload,
  UpdateItemPayload,
  CloneItemPayload,
  CreateAnnotationPayload,
  CreateRelationshipPayload,
  BreadcrumbPayload,
  StarredPayload,
  // API namespace interfaces
  ConfigApi,
  ItemsApi,
  TreeApi,
  AliasesApi,
  RelationshipsApi,
  TagsApi,
  TypesApi,
  BreadcrumbApi,
  StudioApi,
  SkillsApi,
  ClaudeApi,
  // Client
  ApiClientOptions,
  KanectaApiClient,
  createApiClient,
} from '@kanecta/api-client';

// Legacy alias kept for backward compatibility
export { ApiClientOptions as ClientOptions } from '@kanecta/api-client';

export interface KanectaClient extends KanectaApiClient {
  /** Send a prompt to Claude and return the response as a string. */
  ai(prompt: string, context?: string): Promise<string>;
  /** Create an item under a parent. */
  writeItem(parentId: string, value: string, extra?: Omit<CreateItemPayload, 'parentId' | 'value'>): Promise<KanectaItem>;
}

export declare function createClient(options?: ApiClientOptions): KanectaClient;
