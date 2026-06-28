import type { Meta, StoryObj } from '@storybook/react';
import { ThemeProvider, createTheme } from '@mui/material/styles';
import { ActivityFeed } from './ActivityFeed';
import { useReviewStore } from '../../../store/review';
import type { ActivityEvent } from '../../../types/workspace';
import type { KanectaItem } from '../../../types/kanecta';

function makeItem(id: string, value: string): KanectaItem {
  return { id, value, type: 'note', confidence: 'medium', sortOrder: 0, tags: [], createdAt: '', modifiedAt: '' };
}

const events: ActivityEvent[] = [
  { id: '1', workspaceId: 'ws-1', item: makeItem('a', 'Climate change accelerates'), operation: 'created', seenAt: new Date(Date.now() - 60_000).toISOString() },
  { id: '2', workspaceId: 'ws-1', item: makeItem('b', 'Sea levels rising faster'), operation: 'modified', seenAt: new Date(Date.now() - 300_000).toISOString() },
  { id: '3', workspaceId: 'ws-2', item: makeItem('c', 'Carbon capture research'), operation: 'created', seenAt: new Date(Date.now() - 900_000).toISOString() },
];

function Seeded({ children }: { children: React.ReactNode }) {
  useReviewStore.setState({ activityLog: events });
  return <>{children}</>;
}

const meta: Meta<typeof ActivityFeed> = {
  component: ActivityFeed,
  title: 'Views/ActivityFeed',
  decorators: [
    (Story) => (
      <ThemeProvider theme={createTheme()}>
        <Seeded>
          <div style={{ width: 300, height: 400, border: '1px solid #ddd' }}>
            <Story />
          </div>
        </Seeded>
      </ThemeProvider>
    ),
  ],
};
export default meta;

type Story = StoryObj<typeof ActivityFeed>;

export const WithActivity: Story = {};

export const Empty: Story = {
  decorators: [
    (Story) => {
      useReviewStore.setState({ activityLog: [] });
      return <Story />;
    },
  ],
};
