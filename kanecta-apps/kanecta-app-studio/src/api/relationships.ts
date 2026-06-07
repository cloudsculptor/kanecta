import type { KanectaApiClient } from '@kanecta/api-client';
import type { Relationship, CreateRelationshipPayload } from '../types/kanecta';

export function relationshipsApi(client: KanectaApiClient) {
  return {
    list: () =>
      client.relationships.list().then((rows) =>
        rows.map((r) => ({
          id: r.id,
          fromId: r.sourceId,
          toId: r.targetId,
          type: r.type as Relationship['type'],
          createdAt: r.createdAt,
        })),
      ),
    create: (payload: CreateRelationshipPayload) =>
      client.relationships
        .create({ sourceId: payload.fromId, type: payload.type, targetId: payload.toId })
        .then((r) => ({
          id: r.id,
          fromId: r.sourceId,
          toId: r.targetId,
          type: r.type as Relationship['type'],
          createdAt: r.createdAt,
        })),
  };
}
