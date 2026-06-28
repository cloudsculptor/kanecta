import type { KanectaItem } from '../types/kanecta';
import type { ActivityEvent } from '../types/workspace';

export function diffItems(
  workspaceId: string,
  previous: Map<string, KanectaItem>,
  current: KanectaItem[],
): ActivityEvent[] {
  const events: ActivityEvent[] = [];
  const seenAt = new Date().toISOString();

  for (const item of current) {
    const prev = previous.get(item.id);
    if (!prev) {
      events.push({ id: crypto.randomUUID(), workspaceId, item, operation: 'created', seenAt });
    } else if (prev.modifiedAt !== item.modifiedAt) {
      events.push({ id: crypto.randomUUID(), workspaceId, item, operation: 'modified', seenAt });
    }
  }

  return events;
}

export function buildItemMap(items: KanectaItem[]): Map<string, KanectaItem> {
  return new Map(items.map((i) => [i.id, i]));
}
