import { describe, it, expect } from 'vitest';
import { findUnlinkedMentions, extractMentionIds } from '../mentions';
import type { KanectaItem } from '../../types/kanecta';

const makeItem = (id: string, value: string, type: KanectaItem['type'] = 'note'): KanectaItem => ({
  id,
  value,
  type,
  confidence: 'medium',
  sortOrder: 0,
  tags: [],
  createdAt: new Date().toISOString(),
  modifiedAt: new Date().toISOString(),
});

describe('findUnlinkedMentions', () => {
  it('returns empty when focused item has no tokens', () => {
    const focused = makeItem('a', '');
    const others = [makeItem('b', 'climate change warming')];
    expect(findUnlinkedMentions(focused, others, new Set())).toHaveLength(0);
  });

  it('excludes the focused item itself', () => {
    const focused = makeItem('a', 'climate change global warming');
    const others = [focused, makeItem('b', 'some unrelated thing')];
    const results = findUnlinkedMentions(focused, others, new Set());
    expect(results.map((r) => r.item.id)).not.toContain('a');
  });

  it('excludes already-linked items', () => {
    const focused = makeItem('a', 'climate change global warming');
    const linked = makeItem('b', 'climate change effects');
    const others = [linked, makeItem('c', 'sea level rise climate')];
    const results = findUnlinkedMentions(focused, others, new Set(['b']));
    expect(results.map((r) => r.item.id)).not.toContain('b');
  });

  it('returns items above the similarity threshold', () => {
    const focused = makeItem('a', 'climate change global warming effects');
    const similar = makeItem('b', 'climate change effects policy');
    const unrelated = makeItem('c', 'cooking recipe pasta dinner');
    const results = findUnlinkedMentions(focused, [similar, unrelated], new Set());
    const ids = results.map((r) => r.item.id);
    expect(ids).toContain('b');
    expect(ids).not.toContain('c');
  });

  it('sorts results by score descending', () => {
    const focused = makeItem('a', 'machine learning neural network deep');
    const best = makeItem('b', 'machine learning neural network models');
    const ok = makeItem('c', 'machine learning algorithms');
    const results = findUnlinkedMentions(focused, [ok, best], new Set());
    expect(results[0].score).toBeGreaterThanOrEqual(results[results.length - 1].score);
    expect(results[0].item.id).toBe('b');
  });

  it('caps results at 10', () => {
    const focused = makeItem('a', 'machine learning neural networks deep learning');
    const others = Array.from({ length: 20 }, (_, i) =>
      makeItem(`item-${i}`, `machine learning networks deep neural ${i}`),
    );
    const results = findUnlinkedMentions(focused, others, new Set());
    expect(results.length).toBeLessThanOrEqual(10);
  });

  it('respects a custom threshold', () => {
    const focused = makeItem('a', 'the quick brown fox');
    const marginal = makeItem('b', 'the quick red fox');
    const low = makeItem('c', 'the slow blue cat');
    const highThresholdResults = findUnlinkedMentions(focused, [marginal, low], new Set(), 0.5);
    const lowThresholdResults = findUnlinkedMentions(focused, [marginal, low], new Set(), 0.01);
    expect(highThresholdResults.length).toBeLessThanOrEqual(lowThresholdResults.length);
  });
});

describe('extractMentionIds', () => {
  it('extracts a single mention id', () => {
    const content = 'See [[550e8400-e29b-41d4-a716-446655440000]] for details.';
    expect(extractMentionIds(content)).toEqual(['550e8400-e29b-41d4-a716-446655440000']);
  });

  it('extracts multiple mention ids', () => {
    const a = '550e8400-e29b-41d4-a716-446655440000';
    const b = '6ba7b810-9dad-11d1-80b4-00c04fd430c8';
    const content = `[[${a}]] and [[${b}]]`;
    const ids = extractMentionIds(content);
    expect(ids).toContain(a);
    expect(ids).toContain(b);
    expect(ids).toHaveLength(2);
  });

  it('deduplicates repeated mentions', () => {
    const id = '550e8400-e29b-41d4-a716-446655440000';
    const content = `[[${id}]] again [[${id}]]`;
    expect(extractMentionIds(content)).toHaveLength(1);
  });

  it('returns empty for content without mentions', () => {
    expect(extractMentionIds('No mentions here')).toHaveLength(0);
  });

  it('ignores malformed brackets', () => {
    expect(extractMentionIds('[[not-a-uuid]]')).toHaveLength(0);
    expect(extractMentionIds('[one-bracket]')).toHaveLength(0);
  });
});
