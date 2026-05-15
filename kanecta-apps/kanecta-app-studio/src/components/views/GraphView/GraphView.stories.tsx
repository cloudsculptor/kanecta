import type { Meta, StoryObj } from '@storybook/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ThemeProvider, createTheme } from '@mui/material/styles';
import { GraphView } from './GraphView';

const decorator = (Story: React.ComponentType) => (
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
    <ThemeProvider theme={createTheme()}>
      <div style={{ width: 800, height: 600, position: 'relative', background: '#fafafa' }}>
        <Story />
      </div>
    </ThemeProvider>
  </QueryClientProvider>
);

const meta: Meta<typeof GraphView> = {
  component: GraphView,
  title: 'Views/GraphView',
  decorators: [decorator],
};
export default meta;

type Story = StoryObj<typeof GraphView>;

export const Default: Story = {};
