import type { Meta, StoryObj } from '@storybook/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ThemeProvider, createTheme } from '@mui/material/styles';
import { ReviewConveyor } from './ReviewConveyor';
import { useReviewStore } from '../../../store/review';
import type { KanectaItem } from '../../../types/kanecta';

function makeItem(id: string, value: string, confidence: KanectaItem['confidence'] = 'low'): KanectaItem {
  return { id, value, type: 'claim', confidence, sortOrder: 0, tags: ['research'], createdAt: new Date().toISOString(), modifiedAt: new Date().toISOString() };
}

const items = [
  makeItem('1', 'Carbon emissions are the primary driver of climate change'),
  makeItem('2', 'Electric vehicles will replace all combustion engines by 2040'),
  makeItem('3', 'Nuclear power is a viable path to net zero', 'medium'),
];

function Seeded({ children }: { children: React.ReactNode }) {
  useReviewStore.setState({ reviewQueue: items, conveyorIndex: 0 });
  return <>{children}</>;
}

const decorator = (Story: React.ComponentType) => (
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
    <ThemeProvider theme={createTheme()}>
      <Seeded>
        <div style={{ height: 600, display: 'flex', flexDirection: 'column' }}>
          <Story />
        </div>
      </Seeded>
    </ThemeProvider>
  </QueryClientProvider>
);

const meta: Meta<typeof ReviewConveyor> = {
  component: ReviewConveyor,
  title: 'Views/ReviewConveyor',
  decorators: [decorator],
};
export default meta;

type Story = StoryObj<typeof ReviewConveyor>;

export const Active: Story = {
  args: { onClose: () => alert('close') },
};

export const Done: Story = {
  decorators: [
    (Story) => {
      useReviewStore.setState({ reviewQueue: items, conveyorIndex: items.length });
      return <Story />;
    },
  ],
  args: { onClose: () => alert('close') },
};
