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
export declare function createClient(options?: import('@kanecta/api-client').ApiClientOptions): import('@kanecta/api-client').KanectaApiClient;
