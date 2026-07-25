import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { BranchDiffList, changedFields, snapshotLabel } from '../BranchDiffList';
import type { DiffItemSnapshot } from '../../../api/workingSets';

function snap(overrides: Partial<DiffItemSnapshot> = {}): DiffItemSnapshot {
  return {
    id: 'aaaaaaaa-1111-2222-3333-444444444444',
    value: 'An item',
    type: 'note',
    parentId: null,
    tags: [],
    modifiedAt: '2026-07-01T00:00:00Z',
    modifiedBy: null,
    ...overrides,
  };
}

describe('changedFields', () => {
  it('lists exactly the fields that differ, sorted', () => {
    const before = snap({ value: 'Old', status: 'draft' });
    const after = snap({ value: 'New', status: 'ready', tags: ['x'] });
    expect(changedFields(before, after)).toEqual([
      { field: 'status', before: 'draft', after: 'ready' },
      { field: 'tags', before: [], after: ['x'] },
      { field: 'value', before: 'Old', after: 'New' },
    ]);
  });

  it('ignores bookkeeping fields (modifiedAt/modifiedBy/cachedAt/specVersion/icon)', () => {
    const before = snap();
    const after = snap({
      modifiedAt: '2026-07-15T00:00:00Z',
      modifiedBy: 'someone',
      cachedAt: 'now',
      specVersion: '1.4.1',
      icon: 'other',
    });
    expect(changedFields(before, after)).toEqual([]);
  });

  it('reports fields present on only one side', () => {
    const before = snap();
    const after = snap({ aspect: 'task' });
    expect(changedFields(before, after)).toEqual([
      { field: 'aspect', before: undefined, after: 'task' },
    ]);
  });
});

describe('snapshotLabel', () => {
  it('uses a string value directly', () => {
    expect(snapshotLabel(snap({ value: 'Hello' }))).toBe('Hello');
  });
  it('uses name/title from an object value', () => {
    expect(snapshotLabel(snap({ value: { name: 'Named' } }))).toBe('Named');
    expect(snapshotLabel(snap({ value: { title: 'Titled' } }))).toBe('Titled');
  });
  it('falls back to the type', () => {
    expect(snapshotLabel(snap({ value: { colour: 'red' }, type: 'swatch' }))).toBe('(swatch)');
    expect(snapshotLabel(snap({ value: null, type: undefined }))).toBe('(untitled)');
  });
});

describe('BranchDiffList', () => {
  it('renders one row per change with kind, label, type, and short id', () => {
    render(
      <BranchDiffList
        detail={{
          adds: [{ id: 'aaaaaaaa-1111-2222-3333-444444444444', after: snap({ value: 'Added' }) }],
          edits: [
            {
              id: 'bbbbbbbb-1111-2222-3333-444444444444',
              before: snap({ value: 'Old title' }),
              after: snap({ value: 'New title' }),
            },
          ],
          deletes: [
            { id: 'cccccccc-1111-2222-3333-444444444444', before: snap({ value: 'Removed' }) },
          ],
        }}
      />,
    );
    const list = screen.getByTestId('branch-diff-list');
    expect(list).toHaveTextContent('Added');
    expect(list).toHaveTextContent('New title');
    expect(list).toHaveTextContent('Removed');
    expect(list).toHaveTextContent('aaaaaaaa');
    // One type chip per change row (the type also appears inside field tables).
    expect(screen.getAllByText('note', { selector: '.BranchDiffList__type' })).toHaveLength(3);
  });

  it('expands an edit to a before → after field table, bookkeeping excluded', async () => {
    const user = userEvent.setup();
    render(
      <BranchDiffList
        detail={{
          adds: [],
          edits: [
            {
              id: 'bbbbbbbb-1111-2222-3333-444444444444',
              before: snap({ value: 'Old title', status: 'draft' }),
              after: snap({
                value: 'New title',
                status: 'ready',
                modifiedAt: '2026-07-15T00:00:00Z',
              }),
            },
          ],
          deletes: [],
        }}
      />,
    );
    // The summary label — the same text also sits in the (hidden) field table.
    await user.click(screen.getByText('New title', { selector: '.BranchDiffList__label' }));
    expect(screen.getByText('Old title')).toBeInTheDocument();
    expect(screen.getByText('draft')).toBeInTheDocument();
    expect(screen.getByText('ready')).toBeInTheDocument();
    expect(screen.queryByText('modifiedAt')).not.toBeInTheDocument();
  });

  it('says so when an edit only touched modification metadata', async () => {
    const user = userEvent.setup();
    render(
      <BranchDiffList
        detail={{
          adds: [],
          edits: [
            {
              id: 'bbbbbbbb-1111-2222-3333-444444444444',
              before: snap(),
              after: snap({ modifiedAt: '2026-07-15T00:00:00Z' }),
            },
          ],
          deletes: [],
        }}
      />,
    );
    await user.click(screen.getByText('An item'));
    expect(screen.getByText('Only modification metadata changed.')).toBeInTheDocument();
  });

  it('shows the substance fields of an add when expanded', async () => {
    const user = userEvent.setup();
    render(
      <BranchDiffList
        detail={{
          adds: [
            {
              id: 'aaaaaaaa-1111-2222-3333-444444444444',
              after: snap({ value: 'Added', tags: ['committee'] }),
            },
          ],
          edits: [],
          deletes: [],
        }}
      />,
    );
    await user.click(screen.getByText('Added', { selector: '.BranchDiffList__label' }));
    expect(screen.getByText('value')).toBeInTheDocument();
    expect(screen.getByText('["committee"]')).toBeInTheDocument();
    // Null/empty metadata rows are omitted.
    expect(screen.queryByText('parentId')).not.toBeInTheDocument();
  });

  it('renders nothing for an empty detail', () => {
    render(<BranchDiffList detail={{ adds: [], edits: [], deletes: [] }} />);
    expect(screen.queryByTestId('branch-diff-list')).not.toBeInTheDocument();
  });
});
