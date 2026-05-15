import type { Meta, StoryObj } from '@storybook/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ThemeProvider, createTheme } from '@mui/material/styles';
import { MissionControl } from './MissionControl';

const decorator = (Story: React.ComponentType) => (
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
    <ThemeProvider theme={createTheme()}>
      <div style={{ width: 900, height: 600, position: 'relative' }}>
        <Story />
      </div>
    </ThemeProvider>
  </QueryClientProvider>
);

const meta: Meta<typeof MissionControl> = {
  component: MissionControl,
  title: 'Views/MissionControl',
  decorators: [decorator],
};
export default meta;

type Story = StoryObj<typeof MissionControl>;

export const Default: Story = {};
