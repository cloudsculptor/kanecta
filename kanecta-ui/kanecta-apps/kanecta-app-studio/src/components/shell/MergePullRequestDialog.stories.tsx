import type { Meta, StoryObj } from '@storybook/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { within, userEvent, expect } from 'storybook/test';
import { MergePullRequestDialog } from './MergePullRequestDialog';
import type { MergePreview } from '../../api/workingSets';

const WS = 'kanecta-internal';
const BRANCH = 'feature/edits';

const snap = (id: string, value: string, extra: Record<string, unknown> = {}) => ({
  id,
  value,
  type: 'note',
  parentId: null,
  tags: [],
  ...extra,
});

const clean: MergePreview = {
  branch: BRANCH,
  adds: 3,
  edits: 2,
  deletes: 1,
  conflicts: [],
  blastRadius: [],
  detail: {
    adds: [
      { id: '11111111-aaaa-bbbb-cccc-dddddddddddd', after: snap('11111111-aaaa-bbbb-cccc-dddddddddddd', 'Fundraising ideas') },
      { id: '22222222-aaaa-bbbb-cccc-dddddddddddd', after: snap('22222222-aaaa-bbbb-cccc-dddddddddddd', 'Sponsor list') },
      { id: '33333333-aaaa-bbbb-cccc-dddddddddddd', after: snap('33333333-aaaa-bbbb-cccc-dddddddddddd', 'Poster draft') },
    ],
    edits: [
      {
        id: '44444444-aaaa-bbbb-cccc-dddddddddddd',
        before: snap('44444444-aaaa-bbbb-cccc-dddddddddddd', 'AGM agenda', { status: 'draft' }),
        after: snap('44444444-aaaa-bbbb-cccc-dddddddddddd', 'AGM agenda 2026', { status: 'ready' }),
      },
      {
        id: '55555555-aaaa-bbbb-cccc-dddddddddddd',
        before: snap('55555555-aaaa-bbbb-cccc-dddddddddddd', 'Budget', { tags: [] }),
        after: snap('55555555-aaaa-bbbb-cccc-dddddddddddd', 'Budget', { tags: ['approved'] }),
      },
    ],
    deletes: [
      { id: '66666666-aaaa-bbbb-cccc-dddddddddddd', before: snap('66666666-aaaa-bbbb-cccc-dddddddddddd', 'Old flyer') },
    ],
  },
};

// Seed the merge-preview query so each state renders deterministically without a
// network call. staleTime: Infinity means react-query serves the seed as fresh —
// no loading flash, so the merge button's enabled/disabled state is stable on mount.
function withPreview(data: MergePreview) {
  return (Story: React.ComponentType) => {
    const client = new QueryClient({
      defaultOptions: { queries: { staleTime: Infinity, retry: false } },
    });
    client.setQueryData(['merge-preview', WS, BRANCH], data);
    return (
      <QueryClientProvider client={client}>
        <Story />
      </QueryClientProvider>
    );
  };
}

const meta: Meta<typeof MergePullRequestDialog> = {
  component: MergePullRequestDialog,
  title: 'Shell/MergePullRequestDialog',
  parameters: { layout: 'fullscreen' },
  args: {
    open: true,
    workingSetName: WS,
    branch: BRANCH,
    diff: { adds: 3, edits: 2, deletes: 1 },
    onClose: () => {},
    onMerged: () => {},
  },
};
export default meta;

type Story = StoryObj<typeof MergePullRequestDialog>;

/** A clean branch — merges straight into main. */
export const Default: Story = {
  decorators: [withPreview(clean)],
  play: async ({ canvasElement }) => {
    const body = within(canvasElement.ownerDocument.body);
    await expect(body.getByText('Create pull request')).toBeInTheDocument();
    await expect(body.getByText('+3 added')).toBeInTheDocument();
    // The item-level review list renders from the preview's detail payload.
    // Scope to the summary label — the same text also sits in the field table.
    const label = { selector: '.BranchDiffList__label' };
    await expect(body.getByTestId('branch-diff-list')).toBeInTheDocument();
    await expect(body.getByText('Fundraising ideas', label)).toBeInTheDocument();
    await userEvent.click(body.getByText('AGM agenda 2026', label));
    await expect(body.getByText('AGM agenda')).toBeInTheDocument();
    await expect(body.getByRole('button', { name: 'Merge into main' })).toBeEnabled();
  },
};

/** A branch with no changes cannot be merged. */
export const NoChanges: Story = {
  args: { diff: { adds: 0, edits: 0, deletes: 0 } },
  decorators: [withPreview({ ...clean, adds: 0, edits: 2, deletes: 1 })],
  play: async ({ canvasElement }) => {
    const body = within(canvasElement.ownerDocument.body);
    await expect(body.getByText('This branch has no changes to merge.')).toBeInTheDocument();
    await expect(body.getByRole('button', { name: 'Merge into main' })).toBeDisabled();
  },
};

/** Main moved since the fork — a strategy must be chosen before merging. */
export const WithConflicts: Story = {
  args: { diff: { adds: 1, edits: 2, deletes: 0 } },
  decorators: [
    withPreview({
      ...clean,
      adds: 1,
      edits: 2,
      deletes: 0,
      conflicts: [
        { id: 'aaaaaaaa-1111-2222-3333-444444444444', kind: 'edit-edit' },
        { id: 'dddddddd-1111-2222-3333-444444444444', kind: 'delete-edit' },
      ],
    }),
  ],
  play: async ({ canvasElement }) => {
    const body = within(canvasElement.ownerDocument.body);
    await expect(body.getByTestId('merge-conflicts')).toBeInTheDocument();
    const merge = body.getByRole('button', { name: 'Merge into main' });
    await expect(merge).toBeDisabled();
    await userEvent.click(body.getByRole('radio', { name: /Keep this branch's version/ }));
    await expect(merge).toBeEnabled();
  },
};

/** Deleting items still referenced on main — surfaced as a warning. */
export const WithBlastRadius: Story = {
  args: { diff: { adds: 0, edits: 0, deletes: 2 } },
  decorators: [
    withPreview({
      ...clean,
      adds: 0,
      edits: 0,
      deletes: 2,
      blastRadius: [
        {
          id: 'bbbbbbbb-1111-2222-3333-444444444444',
          referencedBy: [
            { id: 'cccccccc-1111-2222-3333-444444444444', via: 'parent' },
            { id: 'eeeeeeee-1111-2222-3333-444444444444', via: 'link' },
          ],
        },
      ],
    }),
  ],
  play: async ({ canvasElement }) => {
    const body = within(canvasElement.ownerDocument.body);
    await expect(body.getByTestId('merge-blast-radius')).toBeInTheDocument();
    await expect(body.getByText(/referenced by 2 items/)).toBeInTheDocument();
  },
};
