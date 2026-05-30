import { makeClient } from './client';
import { itemsApi } from './items';
import { aliasesApi } from './aliases';
import { relationshipsApi } from './relationships';
import { tagsApi } from './tags';
import { treeApi } from './tree';
import { typesApi } from './types';
import { breadcrumbApi } from './breadcrumb';
import { starredApi } from './starred';
import { settingsApi } from './settings';
import { skillsApi } from './skills';
import { claudeApi } from './claude';

export { ApiError } from './client';
export type { AliasEntry } from './aliases';
export type { TypeDefinition } from './types';
export type { ClipboardEntry } from './breadcrumb';
export type { SkillFile, SkillFileWithContent } from './skills';
export type { ClaudeEvent, ApprovalNeededEvent, ToolRanEvent } from './claude';
export type { AppSettings } from './settings';

export function createApi(baseUrl: string) {
  const client = makeClient(baseUrl);
  return {
    items: itemsApi(client),
    aliases: aliasesApi(client),
    relationships: relationshipsApi(client),
    tags: tagsApi(client),
    tree: treeApi(client),
    types: typesApi(client),
    breadcrumb: breadcrumbApi(client),
    starred: starredApi(client),
    skills: skillsApi(client),
    claude: claudeApi(client, baseUrl),
    settings: settingsApi(client),
  };
}

export type KanectaApi = ReturnType<typeof createApi>;

const DEFAULT_API_URL = import.meta.env.VITE_KANECTA_API_URL ?? '/api';
export const api = createApi(DEFAULT_API_URL);
