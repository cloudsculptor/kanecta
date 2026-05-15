import type { Meta, StoryObj } from '@storybook/react';
import { HistoryTimeline } from './HistoryTimeline';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const qc = new QueryClient({
  defaultOptions: { queries: { retry: false } },
});

const meta: Meta<typeof HistoryTimeline> = {
  component: HistoryTimeline,
  title: 'Item/HistoryTimeline',
  decorators: [
    (Story) => (
      <QueryClientProvider client={qc}>
        <div style={{ padding: 16, maxWidth: 400 }}>
          <Story />
        </div>
      </QueryClientProvider>
    ),
  ],
};
export default meta;

type Story = StoryObj<typeof HistoryTimeline>;

export const Loading: Story = { args: { itemId: 'nonexistent-id-loading' } };
