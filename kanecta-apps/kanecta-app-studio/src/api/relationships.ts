import type { ApiClient } from './client';
import type { Relationship, CreateRelationshipPayload } from '../types/kanecta';

export function relationshipsApi(client: ApiClient) {
  return {
    create: (payload: CreateRelationshipPayload) =>
      client.post<Relationship>('/relationships', {
        sourceId: payload.fromId,
        type: payload.type,
        targetId: payload.toId,
      }),
  };
}
