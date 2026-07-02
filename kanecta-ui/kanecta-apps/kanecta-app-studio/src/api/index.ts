import { createApiClient, ApiError } from '@kanecta/api-client';
import keycloak from '../auth/keycloak';
import { itemsApi } from './items';
import { aliasesApi } from './aliases';
import { relationshipsApi } from './relationships';
import { tagsApi } from './tags';
import { treeApi } from './tree';
import { documentsApi } from './documents';
import { typesApi } from './types';
import { breadcrumbApi } from './breadcrumb';
import { starredApi } from './starred';
import { settingsApi } from './settings';
import { systemItemsApi } from './systemItems';
import { skillsApi } from './skills';
import { claudeApi } from './claude';
import { viewApi } from './view';
import { layoutsApi } from './layouts';
import { workingSetsApi } from './workingSets';
export type { ViewSettings } from './view';
export type { WorkingSet, WorkingSetBranch, WorkingSetRemote } from './workingSets';

export { ApiError };
export type { AliasEntry } from './aliases';
export type { TypeDefinition } from './types';
export type { ClipboardEntry } from './breadcrumb';
export type { SkillFile, SkillFileWithContent } from './skills';
export type { ClaudeEvent, ApprovalNeededEvent, ToolRanEvent } from './claude';
export type { AppSettings } from './settings';
export type { WorkingSetsList } from './workingSets';

/**
 * Normalised `GET /config` response. The backend now returns
 * `{ datastorePath, workingSetName, vscodeAvailable }`. The generated
 * api-client type does not yet describe `workingSetName`, so we widen it here.
 */
export interface StudioConfig {
  datastorePath: string;
  workingSetName?: string;
  vscodeAvailable: boolean;
}

export function createApi(baseUrl: string) {
  // `keycloak.token` is undefined when unauthenticated or when auth is
  // disabled (VITE_AUTH_DISABLED=true) — the client then sends no
  // Authorization header, matching the backend's AUTH_DISABLED bypass.
  // Read it lazily (not just once) since KeycloakProvider refreshes it
  // in place as the session continues.
  const client = createApiClient({ baseUrl, token: () => keycloak.token });
  return {
    config: {
      get: () => client.config.get() as unknown as Promise<StudioConfig>,
      openPath: (path: string) => client.config.openPath(path),
      openInBrowser: (path: string) => client.config.openInBrowser(path),
      openInVscode: (path: string) => client.config.openInVSCode(path),
    },
    items: itemsApi(client),
    aliases: aliasesApi(client),
    relationships: relationshipsApi(client),
    tags: tagsApi(client),
    tree: treeApi(client),
    documents: documentsApi(client),
    types: typesApi(client),
    breadcrumb: breadcrumbApi(client),
    starred: starredApi(client),
    skills: skillsApi(client),
    claude: claudeApi(client),
    settings: settingsApi(client),
    systemItems: systemItemsApi(client),
    view: viewApi(client),
    layouts: layoutsApi(client),
    workingSets: workingSetsApi(client),
  };
}

export type KanectaApi = ReturnType<typeof createApi>;

const DEFAULT_API_URL = import.meta.env.VITE_KANECTA_API_URL ?? '/api';
export const api = createApi(DEFAULT_API_URL);
