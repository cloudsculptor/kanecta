import type { KanectaItem } from '../types/kanecta';
import type { ActivityEvent } from '../types/workingSet';

export interface DigestGroup {
  parentId: string | null;
  parentValue: string;
  events: ActivityEvent[];
  createdCount: number;
  modifiedCount: number;
  latestAt: string;
}

export interface Digest {
  groups: DigestGroup[];
  totalEvents: number;
  conflictCount: number;
  reviewBacklogCount: number;
  lastActiveAt: string | null;
}

export function buildDigest(
  events: ActivityEvent[],
  allItems: KanectaItem[],
  conflictCount: number,
  reviewBacklogCount: number,
): Digest {
  const itemMap = new Map(allItems.map((i) => [i.id, i]));
  const grouped = new Map<string | null, ActivityEvent[]>();

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
