import type { KanectaItem } from '../types/kanecta';

export interface MentionSuggestion {
  item: KanectaItem;
  score: number;
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

export function findUnlinkedMentions(
  focusedItem: KanectaItem,
  allItems: KanectaItem[],
  linkedIds: Set<string>,
  threshold = 0.15,
): MentionSuggestion[] {
  const focusedTokens = tokenise(focusedItem.value);
  if (focusedTokens.length === 0) return [];

  const suggestions: MentionSuggestion[] = [];

  for (const item of allItems) {
    if (item.id === focusedItem.id) continue;
    if (linkedIds.has(item.id)) continue;

    const tokens = tokenise(item.value);
    const score = jaccardSimilarity(focusedTokens, tokens);

    if (score >= threshold) {
      suggestions.push({ item, score });
    }
  }

  return suggestions.sort((a, b) => b.score - a.score).slice(0, 10);
}

export function extractMentionIds(content: string): string[] {
  const re = /\[\[([0-9a-f-]{36})\]\]/gi;
  const ids: string[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(content)) !== null) {
    ids.push(m[1]);
  }
  return [...new Set(ids)];
}
