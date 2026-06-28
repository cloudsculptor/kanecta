import type { KanectaApiClient } from '@kanecta/api-client';

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

export function systemItemsApi(client: KanectaApiClient) {
  return {
    list: () => client.systemItems.getSync() as unknown as Promise<SystemItem[]>,
    importItems: (folderIds: string[]) =>
      client.systemItems.import(folderIds) as unknown as Promise<ImportResult>,
    exportItems: (itemIds: string[]) =>
      client.systemItems.export(itemIds) as unknown as Promise<ExportResult>,
  };
}
