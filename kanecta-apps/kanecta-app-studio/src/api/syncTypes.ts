import type { ApiClient } from './client';

export interface CommonType {
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

export function syncTypesApi(client: ApiClient) {
  return {
    listCommon: () => client.get<CommonType[]>('/app/studio/sync-types'),
    importTypes: (folderIds: string[]) =>
      client.post<ImportResult>('/app/studio/sync-types/import', { folderIds }),
    exportTypes: (typeIds: string[]) =>
      client.post<ExportResult>('/app/studio/sync-types/export', { typeIds }),
  };
}
