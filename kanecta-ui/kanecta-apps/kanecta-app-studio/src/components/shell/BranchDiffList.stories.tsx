import type { Meta, StoryObj } from '@storybook/react';
import { within, userEvent, expect } from 'storybook/test';
import { BranchDiffList } from './BranchDiffList';
import type { DiffDetail, DiffItemSnapshot } from '../../api/workingSets';

function snap(overrides: Partial<DiffItemSnapshot>): DiffItemSnapshot {
  return {
    id: 'aaaaaaaa-1111-2222-3333-444444444444',
    value: 'An item',
    type: 'note',
    parentId: null,
    tags: [],
    visibility: 'private',
    sortOrder: 0,
    createdAt: '2026-07-01T00:00:00Z',
    modifiedAt: '2026-07-01T00:00:00Z',
    ...overrides,
  };
}

const detail: DiffDetail = {
  adds: [
    {
      id: 'aaaaaaaa-1111-2222-3333-444444444444',
      after: snap({
        id: 'aaaaaaaa-1111-2222-3333-444444444444',
        value: 'Fundraising ideas',
        type: 'note',
        tags: ['committee'],
      }),
    },
  ],
  edits: [
    {
      id: 'bbbbbbbb-1111-2222-3333-444444444444',
      before: snap({
        id: 'bbbbbbbb-1111-2222-3333-444444444444',
        value: 'AGM agenda',
        status: 'draft',
      }),
      after: snap({
        id: 'bbbbbbbb-1111-2222-3333-444444444444',
        value: 'AGM agenda 2026',
        status: 'ready',
        modifiedAt: '2026-07-15T00:00:00Z',
      }),
    },
  ],
  deletes: [
    {
      id: 'cccccccc-1111-2222-3333-444444444444',
      before: snap({
        id: 'cccccccc-1111-2222-3333-444444444444',
        value: 'Old flyer',
        type: 'file',
      }),
    },
  ],
};

const meta: Meta<typeof BranchDiffList> = {
  component: BranchDiffList,
  title: 'Shell/BranchDiffList',
  args: { detail },
};
export default meta;

type Story = StoryObj<typeof BranchDiffList>;

/** One of each change kind; the edit expands to a field-level before → after. */
export const Default: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    // Scope to the summary label — the same text also sits in the field table.
    const label = { selector: '.BranchDiffList__label' };
    await expect(canvas.getByText('Fundraising ideas', label)).toBeInTheDocument();
    await expect(canvas.getByText('Old flyer', label)).toBeInTheDocument();

    // Expand the edit → the changed fields (and only those) are shown.
    await userEvent.click(canvas.getByText('AGM agenda 2026', label));
    await expect(canvas.getByText('AGM agenda')).toBeInTheDocument();
    await expect(canvas.getByText('ready')).toBeInTheDocument();
    await expect(canvas.queryByText('modifiedAt')).not.toBeInTheDocument();
  },
};

/** An edit where only bookkeeping fields moved. */
export const MetadataOnlyEdit: Story = {
  args: {
    detail: {
      adds: [],
      edits: [
        {
          id: 'dddddddd-1111-2222-3333-444444444444',
          before: snap({ id: 'dddddddd-1111-2222-3333-444444444444' }),
          after: snap({
            id: 'dddddddd-1111-2222-3333-444444444444',
            modifiedAt: '2026-07-15T00:00:00Z',
          }),
        },
      ],
      deletes: [],
    },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByText('An item', { selector: '.BranchDiffList__label' }));
    await expect(canvas.getByText('Only modification metadata changed.')).toBeInTheDocument();
  },
};

/** Empty detail renders nothing. */
export const Empty: Story = {
  args: { detail: { adds: [], edits: [], deletes: [] } },
  play: async ({ canvasElement }) => {
    await expect(
      within(canvasElement).queryByTestId('branch-diff-list'),
    ).not.toBeInTheDocument();
  },
};
