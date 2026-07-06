/**
 * Kanecta SDK — interact with Kanecta and AI from within functions.
 *
 * Thin ergonomic wrapper around `@kanecta/api-client`: re-exports the client's
 * public type surface and adds `ai()` / `writeItem()` convenience methods via a
 * Proxy over the raw client.
 */

import { createApiClient, KanectaApiClient } from '@kanecta/api-client';
import type {
  ApiClientOptions,
  CreateItemPayload,
  KanectaItem,
} from '@kanecta/api-client';

// Re-export the public type surface from the API client.
export type {
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
  ClaudeSession,
  ConfigResponse,
  SearchResult,
  SearchOptions,
  ItemStats,
  BulkCreateResult,
  BulkUpdateResult,
  SyncSystemItem,
  CreateItemPayload,
  UpdateItemPayload,
  CloneItemPayload,
  CreateAnnotationPayload,
  CreateRelationshipPayload,
  BreadcrumbPayload,
  StarredPayload,
  ConfigApi,
  ItemsApi,
  TreeApi,
  AliasesApi,
  RelationshipsApi,
  TagsApi,
  TypesApi,
  BreadcrumbApi,
  SkillsApi,
  ClaudeApi,
  ApiClientOptions,
  // Legacy alias kept for backward compatibility.
  ApiClientOptions as ClientOptions,
} from '@kanecta/api-client';

export { createApiClient, KanectaApiClient };

export interface KanectaClient extends KanectaApiClient {
  /** Send a prompt to Claude and return the response as a string. */
  ai(prompt: string, context?: string): Promise<string>;
  /** Create an item under a parent. */
  writeItem(
    parentId: string,
    value: string,
    extra?: Omit<CreateItemPayload, 'parentId' | 'value'>,
  ): Promise<KanectaItem>;
}

async function runClaudeSession(api: KanectaApiClient, prompt: string): Promise<string> {
  const session = await api.claude.createSession(prompt);
  const response = await api.claude.streamSession(session.id);
  const text = await response.text();
  for (const line of text.split('\n')) {
    if (line.startsWith('data: ')) {
      try {
        const data = JSON.parse(line.slice(6));
        if (data.type === 'done' && data.result) return data.result;
      } catch {
        // Ignore malformed SSE lines.
      }
    }
  }
  return 'No response received';
}

export function createClient(options: ApiClientOptions = {}): KanectaClient {
  const api = createApiClient(options);

  return new Proxy(api, {
    get(target, prop, receiver) {
      if (prop === 'ai') {
        return (prompt: string, context?: string) => {
          const fullPrompt = context ? `${context}\n\n${prompt}` : prompt;
          return runClaudeSession(api, fullPrompt);
        };
      }
      if (prop === 'writeItem') {
        return (
          parentId: string,
          value: string,
          extra: Omit<CreateItemPayload, 'parentId' | 'value'> = {},
        ) => api.items.create({ parentId, value, ...extra });
      }
      return Reflect.get(target, prop, receiver);
    },
  }) as unknown as KanectaClient;
}
