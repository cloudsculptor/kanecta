import type { ApiClient } from './client';
import type { LayoutData } from '../components/views/LayoutsView/types';

export function layoutsApi(client: ApiClient) {
  return {
    get: () => client.get<LayoutData>('/app/studio/layouts'),
    save: (data: LayoutData) => client.put<{ ok: boolean }>('/app/studio/layouts', data),
  };
}
