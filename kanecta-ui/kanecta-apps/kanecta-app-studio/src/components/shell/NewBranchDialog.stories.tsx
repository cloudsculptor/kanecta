import type { Meta, StoryObj } from '@storybook/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { userEvent, within, expect } from 'storybook/test';
import { NewBranchDialog } from './NewBranchDialog';

const meta: Meta<typeof NewBranchDialog> = {
  component: NewBranchDialog,
  title: 'Shell/NewBranchDialog',
  parameters: { layout: 'fullscreen' },
  args: {
    open: true,
    workingSetName: 'kanecta-internal',
    branches: ['main', 'experiment'],
    currentBranch: 'main',
    onClose: () => {},
    onCreated: () => {},
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

type Story = StoryObj<typeof NewBranchDialog>;

export const Default: Story = {};

// Choosing "Sparse" reveals the upstream branch selector.
export const SparseRevealsUpstream: Story = {
  play: async ({ canvasElement }) => {
    const body = within(canvasElement.ownerDocument.body);
    await expect(body.getByText('New branch')).toBeInTheDocument();

    const sparse = body.getByRole('radio', { name: /Sparse/ });
    await userEvent.click(sparse);
    await expect(body.getByLabelText('Upstream branch')).toBeInTheDocument();
  },
};

// A name that clashes with an existing branch is rejected before submit.
export const RejectsDuplicateName: Story = {
  play: async ({ canvasElement }) => {
    const body = within(canvasElement.ownerDocument.body);
    const nameField = body.getByLabelText('Branch name');
    await userEvent.type(nameField, 'experiment');
    await expect(body.getByText('Branch "experiment" already exists')).toBeInTheDocument();
    await expect(body.getByRole('button', { name: 'Create branch' })).toBeDisabled();
  },
};
