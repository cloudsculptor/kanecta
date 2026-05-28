import type { ApiClient } from './client';

export interface TypeDefinition {
  id: string;
  value: string;
  type: 'type';
  createdAt: string;
  modifiedAt: string;
  owner: string;
  icon?: string | null;
  description?: string | null;
  keywords?: string | null;
  tags?: string | null;
}

export function typesApi(client: ApiClient) {
  return {
    list: () => client.get<TypeDefinition[]>('/types'),
    schema: (id: string) => client.get<unknown>(`/types/${id}/schema`),
    saveSchema: (id: string, schema: unknown) => client.put<unknown>(`/types/${id}/schema`, schema),
    create: (value: string) => client.post<TypeDefinition>('/types', { value }),
    metadata: (id: string) => client.get<unknown>(`/types/${id}`),
  };
}
