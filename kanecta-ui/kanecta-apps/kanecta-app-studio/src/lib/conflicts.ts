import type { KanectaItem } from '../types/kanecta';

export interface ConflictPair {
  id: string;
  itemA: KanectaItem;
  workingSetIdA: string;
  itemB: KanectaItem;
  workingSetIdB: string;
  similarity: number;
  reason: 'value-similarity' | 'shared-parent';
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

interface WorkingSetItems {
  workingSetId: string;
  items: KanectaItem[];
}

export function detectConflicts(
  workspaces: WorkingSetItems[],
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
                id: `${itemA.id}:${wsA.workingSetId}:${wsB.workingSetId}`,
                itemA,
                workingSetIdA: wsA.workingSetId,
                itemB,
                workingSetIdB: wsB.workingSetId,
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
                workingSetIdA: wsA.workingSetId,
                itemB,
                workingSetIdB: wsB.workingSetId,
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
              workingSetIdA: wsA.workingSetId,
              itemB,
              workingSetIdB: wsB.workingSetId,
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
