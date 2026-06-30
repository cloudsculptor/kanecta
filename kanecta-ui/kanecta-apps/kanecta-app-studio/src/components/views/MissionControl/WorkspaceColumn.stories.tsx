import type { Meta, StoryObj } from '@storybook/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ThemeProvider, createTheme } from '@mui/material/styles';
import { WorkspaceColumn } from './WorkspaceColumn';
import type { WorkingSetConfig } from '../../../types/workingSet';

const ws: WorkingSetConfig = {
  id: 'ws-1',
  name: 'Primary',
  apiUrl: 'http://localhost:3000',
  colour: '#1976d2',
  pollIntervalMs: 5000,
};

const decorator = (Story: React.ComponentType) => (
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
    <ThemeProvider theme={createTheme()}>
      <div style={{ padding: 24, display: 'flex', gap: 16 }}>
        <Story />
      </div>
    </ThemeProvider>
  </QueryClientProvider>
);

const meta: Meta<typeof WorkspaceColumn> = {
  component: WorkspaceColumn,
  title: 'Views/WorkspaceColumn',
  decorators: [decorator],
};
export default meta;

type Story = StoryObj<typeof WorkspaceColumn>;

export const Green: Story = {
  args: { workspace: ws, onOpenReview: () => alert('open review') },
};

export const Yellow: Story = {
  args: { workspace: { ...ws, name: 'Secondary', colour: '#f57c00' }, onOpenReview: () => alert('open review') },
};

export const Unreachable: Story = {
  args: { workspace: { ...ws, name: 'Remote', colour: '#c62828', apiUrl: 'http://unreachable:9999' }, onOpenReview: () => alert('open review') },
};
