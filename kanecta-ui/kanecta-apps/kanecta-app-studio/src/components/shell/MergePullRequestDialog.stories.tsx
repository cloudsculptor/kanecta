import type { Meta, StoryObj } from '@storybook/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { within, expect } from 'storybook/test';
import { MergePullRequestDialog } from './MergePullRequestDialog';

const meta: Meta<typeof MergePullRequestDialog> = {
  component: MergePullRequestDialog,
  title: 'Shell/MergePullRequestDialog',
  parameters: { layout: 'fullscreen' },
  args: {
    open: true,
    workingSetName: 'kanecta-internal',
    branch: 'feature/edits',
    diff: { adds: 3, edits: 2, deletes: 1 },
    onClose: () => {},
    onMerged: () => {},
  },
  decorators: [
    (Story) => {
      const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
      return (
        <QueryClientProvider client={client}>
          <Story />
        </QueryClientProvider>
      );
    },
  ],
};
export default meta;

type Story = StoryObj<typeof MergePullRequestDialog>;

export const Default: Story = {
  play: async ({ canvasElement }) => {
    const body = within(canvasElement.ownerDocument.body);
    await expect(body.getByText('Create pull request')).toBeInTheDocument();
    await expect(body.getByText('+3 added')).toBeInTheDocument();
    await expect(body.getByRole('button', { name: 'Merge into main' })).toBeEnabled();
  },
};

// A branch with no changes cannot be merged.
export const NoChanges: Story = {
  args: {
    diff: { adds: 0, edits: 0, deletes: 0 },
  },
  play: async ({ canvasElement }) => {
    const body = within(canvasElement.ownerDocument.body);
    await expect(body.getByText('This branch has no changes to merge.')).toBeInTheDocument();
    await expect(body.getByRole('button', { name: 'Merge into main' })).toBeDisabled();
  },
};
