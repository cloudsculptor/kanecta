import type { KanectaApiClient } from '@kanecta/api-client';

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

export function typesApi(client: KanectaApiClient) {
  return {
    list: () => client.types.list() as unknown as Promise<TypeDefinition[]>,
    schema: (id: string) => client.types.getSchema(id),
    saveSchema: (id: string, schema: unknown) =>
      client.types.updateSchema(id, schema as never),
    create: (value: string) => client.types.create(value) as unknown as Promise<TypeDefinition>,
    metadata: (id: string) => client.types.get(id),
  };
}
