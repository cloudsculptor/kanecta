import { describe, it, expect } from 'vitest';
import { detectConflicts } from '../conflicts';
import type { KanectaItem } from '../../types/kanecta';

function makeItem(id: string, value: string, parentId?: string): KanectaItem {
  return { id, value, type: 'claim', confidence: 'low', sortOrder: 0, tags: [], parentId, createdAt: '', modifiedAt: '2024-01-01T00:00:00Z' };
}

describe('detectConflicts', () => {
  it('returns empty for single workspace', () => {
    const conflicts = detectConflicts([{ workspaceId: 'ws-1', items: [makeItem('a', 'hello world')] }]);
    expect(conflicts).toHaveLength(0);
  });

  it('returns empty when items are dissimilar', () => {
    const conflicts = detectConflicts([
      { workspaceId: 'ws-1', items: [makeItem('a', 'climate change global warming effects')] },
      { workspaceId: 'ws-2', items: [makeItem('b', 'pasta recipe dinner cooking italian')] },
    ]);
    expect(conflicts).toHaveLength(0);
  });

  it('detects high-similarity value pairs across workspaces', () => {
    const conflicts = detectConflicts([
      { workspaceId: 'ws-1', items: [makeItem('a', 'machine learning neural network deep model')] },
      { workspaceId: 'ws-2', items: [makeItem('b', 'machine learning neural network deep training')] },
    ]);
    expect(conflicts.length).toBeGreaterThan(0);
    expect(conflicts[0].reason).toBe('value-similarity');
  });

  it('does not flag items from the same workspace', () => {
    const conflicts = detectConflicts([
      {
        workspaceId: 'ws-1',
        items: [
          makeItem('a', 'machine learning neural network deep'),
          makeItem('b', 'machine learning neural network model'),
        ],
      },
    ]);
    expect(conflicts).toHaveLength(0);
  });

  it('detects same-id items with different modifiedAt as shared-parent conflict', () => {
    const itemA = makeItem('shared-id', 'Some claim');
    const itemB = { ...makeItem('shared-id', 'Some claim'), modifiedAt: '2024-06-01T00:00:00Z' };
    const conflicts = detectConflicts([
      { workspaceId: 'ws-1', items: [itemA] },
      { workspaceId: 'ws-2', items: [itemB] },
    ]);
    expect(conflicts.length).toBeGreaterThan(0);
    expect(conflicts[0].reason).toBe('shared-parent');
  });

  it('sorts by similarity descending', () => {
    const conflicts = detectConflicts([
      {
        workspaceId: 'ws-1',
        items: [
          makeItem('a', 'machine learning deep neural networks training'),
          makeItem('c', 'the quick brown fox'),
        ],
      },
      {
        workspaceId: 'ws-2',
        items: [
          makeItem('b', 'machine learning deep neural network models'),
          makeItem('d', 'the quick brown red fox jumps'),
        ],
      },
    ], 0.2);
    for (let i = 1; i < conflicts.length; i++) {
      expect(conflicts[i - 1].similarity).toBeGreaterThanOrEqual(conflicts[i].similarity);
    }
  });

  it('respects custom similarity threshold', () => {
    const highThreshold = detectConflicts([
      { workspaceId: 'ws-1', items: [makeItem('a', 'machine learning deep neural network')] },
      { workspaceId: 'ws-2', items: [makeItem('b', 'machine learning network model')] },
    ], 0.95);

    const lowThreshold = detectConflicts([
      { workspaceId: 'ws-1', items: [makeItem('a', 'machine learning deep neural network')] },
      { workspaceId: 'ws-2', items: [makeItem('b', 'machine learning network model')] },
    ], 0.1);

    expect(highThreshold.length).toBeLessThanOrEqual(lowThreshold.length);
  });
});
