import type { MissionActivityEvent, MissionItem, ConflictPair, Digest, DigestGroup } from './types';

export function buildDigest(
  events: MissionActivityEvent[],
  allItems: MissionItem[],
  conflictCount: number,
  reviewBacklogCount: number,
): Digest {
  const itemMap = new Map(allItems.map((i) => [i.id, i]));
  const grouped = new Map<string | null, MissionActivityEvent[]>();

  for (const event of events) {
    const parentId = event.item.parentId ?? null;
    const bucket = grouped.get(parentId) ?? [];
    bucket.push(event);
    grouped.set(parentId, bucket);
  }

  const groups: DigestGroup[] = [];
  for (const [parentId, groupEvents] of grouped) {
    const parentItem = parentId ? itemMap.get(parentId) : undefined;
    const sorted = [...groupEvents].sort((a, b) => b.seenAt.localeCompare(a.seenAt));
    groups.push({
      parentId,
      parentValue: parentItem?.value ?? '(root)',
      events: sorted,
      createdCount: groupEvents.filter((e) => e.operation === 'created').length,
      modifiedCount: groupEvents.filter((e) => e.operation === 'modified').length,
      latestAt: sorted[0].seenAt,
    });
  }

  groups.sort((a, b) => b.latestAt.localeCompare(a.latestAt));

  const lastActiveAt = events.length > 0
    ? events.reduce((latest, e) => e.seenAt > latest ? e.seenAt : latest, events[0].seenAt)
    : null;

  return { groups, totalEvents: events.length, conflictCount, reviewBacklogCount, lastActiveAt };
}

function tokenise(text: string): string[] {
  return text.toLowerCase().split(/\W+/).filter((t) => t.length > 2);
}

function jaccardSimilarity(a: string[], b: string[]): number {
  if (a.length === 0 && b.length === 0) return 1;
  const setA = new Set(a);
  const setB = new Set(b);
  let intersection = 0;
  for (const t of setA) {
    if (setB.has(t)) intersection++;
  }
  const union = setA.size + setB.size - intersection;
  return union === 0 ? 0 : intersection / union;
}

interface WorkspaceItems {
  workspaceId: string;
  items: MissionItem[];
}

export function detectConflicts(
  workspaces: WorkspaceItems[],
  similarityThreshold = 0.6,
): ConflictPair[] {
  const conflicts: ConflictPair[] = [];

  for (let i = 0; i < workspaces.length; i++) {
    for (let j = i + 1; j < workspaces.length; j++) {
      const wsA = workspaces[i];
      const wsB = workspaces[j];

      for (const itemA of wsA.items) {
        const tokensA = tokenise(itemA.value);

        for (const itemB of wsB.items) {
          if (itemA.id === itemB.id) {
            if (itemA.modifiedAt !== itemB.modifiedAt) {
              conflicts.push({
                id: `${itemA.id}:${wsA.workspaceId}:${wsB.workspaceId}`,
                itemA,
                workspaceIdA: wsA.workspaceId,
                itemB,
                workspaceIdB: wsB.workspaceId,
                similarity: 1,
                reason: 'shared-parent',
              });
            }
            continue;
          }

          if (itemA.parentId && itemA.parentId === itemB.parentId) {
            const sim = jaccardSimilarity(tokensA, tokenise(itemB.value));
            if (sim >= similarityThreshold) {
              conflicts.push({
                id: `${itemA.id}:${itemB.id}`,
                itemA,
                workspaceIdA: wsA.workspaceId,
                itemB,
                workspaceIdB: wsB.workspaceId,
                similarity: sim,
                reason: 'value-similarity',
              });
            }
            continue;
          }

          const sim = jaccardSimilarity(tokensA, tokenise(itemB.value));
          if (sim >= similarityThreshold) {
            conflicts.push({
              id: `${itemA.id}:${itemB.id}`,
              itemA,
              workspaceIdA: wsA.workspaceId,
              itemB,
              workspaceIdB: wsB.workspaceId,
              similarity: sim,
              reason: 'value-similarity',
            });
          }
        }
      }
    }
  }

  return conflicts.sort((a, b) => b.similarity - a.similarity);
}
