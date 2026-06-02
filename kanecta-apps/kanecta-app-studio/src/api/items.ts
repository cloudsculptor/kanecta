import type { ApiClient } from './client';
import type {
  KanectaItem,
  Annotation,
  Relationship,
  HistoryEntry,
  CreateItemPayload,
  UpdateItemPayload,
  CreateAnnotationPayload,
} from '../types/kanecta';

export function itemsApi(client: ApiClient) {
  return {
    list: () => client.get<KanectaItem[]>('/items'),

    root: () => client.get<KanectaItem>('/items/root'),

    stats: () => client.get<{
      total: number;
      typedCount: number;
      structured: Array<{ typeId: string; name: string; icon: string | null; count: number }>;
      unstructured: Array<{ type: string; count: number }>;
    }>('/items/stats'),

    get: (id: string) => client.get<KanectaItem>(`/items/${id}`),

    create: (payload: CreateItemPayload) => client.post<KanectaItem>('/items', payload),

    update: (id: string, payload: UpdateItemPayload) =>
      client.put<KanectaItem>(`/items/${id}`, payload),

    delete: (id: string, force = false) =>
      client.delete<{ deleted: string }>(`/items/${id}${force ? '?force=true' : ''}`),

    children: (id: string) => client.get<KanectaItem[]>(`/items/${id}/children`),

    tree: (id: string, depth?: number) =>
      client.get<Array<{ item: KanectaItem; depth: number }>>(
        `/items/${id}/tree${depth != null ? `?depth=${depth}` : ''}`,
      ),

    annotations: (id: string) => client.get<Annotation[]>(`/items/${id}/annotations`),

    annotate: (id: string, payload: CreateAnnotationPayload) =>
      client.post<Annotation>(`/items/${id}/annotations`, payload),

    relationships: (id: string) => client.get<Relationship[]>(`/items/${id}/relationships`),

    backlinks: (id: string) => client.get<KanectaItem[]>(`/items/${id}/backlinks`),

    history: (id: string) => client.get<HistoryEntry[]>(`/items/${id}/history`),

    getObject: (id: string) =>
      client.get<Record<string, unknown>>(`/items/${id}/object`),

    saveObject: (id: string, data: Record<string, unknown>) =>
      client.put<{ ok: boolean }>(`/items/${id}/object`, data),

    getFunctionData: (id: string) =>
      client.get<Record<string, unknown>>(`/items/${id}/function`),

    saveFunctionData: (id: string, data: Record<string, unknown>) =>
      client.put<{ ok: boolean }>(`/items/${id}/function`, data),

    checkFunctionScaffold: (id: string) =>
      client.get<{ exists: boolean }>(`/items/${id}/function/scaffold`),
  };
}
