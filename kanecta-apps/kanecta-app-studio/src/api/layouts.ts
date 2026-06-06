import type { KanectaApiClient } from '@kanecta/api-client';
import type { LayoutData } from '../components/views/LayoutsView/types';

export function layoutsApi(client: KanectaApiClient) {
  return {
    get: () => client.layouts.get() as unknown as Promise<LayoutData>,
    save: (data: LayoutData) => client.layouts.save(data as never),
  };
}
