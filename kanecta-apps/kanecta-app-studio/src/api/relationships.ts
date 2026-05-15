import type { ApiClient } from './client';
import type { Relationship, CreateRelationshipPayload } from '../types/kanecta';

export function relationshipsApi(client: ApiClient) {
  return {
    list: () =>
      client
        .get<Array<{ id: string; sourceId: string; targetId: string; type: string; createdAt: string }>>('/relationships')
        .then((rows) =>
          rows.map((r) => ({ id: r.id, fromId: r.sourceId, toId: r.targetId, type: r.type as Relationship['type'], createdAt: r.createdAt })),
        ),
    create: (payload: CreateRelationshipPayload) =>
      client.post<Relationship>('/relationships', {
        sourceId: payload.fromId,
        type: payload.type,
        targetId: payload.toId,
      }),
  };
}
