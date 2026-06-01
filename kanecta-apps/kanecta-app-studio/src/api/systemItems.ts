import type { ApiClient } from './client';

export interface SystemItem {
  folderId: string;
  title: string;
  schema: Record<string, unknown>;
}

export interface ImportResult {
  imported: { id: string; value: string }[];
  errors: { folderId: string; error: string }[];
}

export interface ExportResult {
  exported: { id: string }[];
  errors: { id: string; error: string }[];
}

export function systemItemsApi(client: ApiClient) {
  return {
    list: () => client.get<SystemItem[]>('/app/studio/sync-system-items'),
    importItems: (folderIds: string[]) =>
      client.post<ImportResult>('/app/studio/sync-system-items/import', { folderIds }),
    exportItems: (itemIds: string[]) =>
      client.post<ExportResult>('/app/studio/sync-system-items/export', { typeIds: itemIds }),
  };
}
