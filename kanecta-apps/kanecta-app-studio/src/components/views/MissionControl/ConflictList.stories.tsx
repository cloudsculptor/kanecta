import type { Meta, StoryObj } from '@storybook/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ThemeProvider, createTheme } from '@mui/material/styles';
import { ConflictList } from './ConflictList';
import type { ConflictPair } from '../../../lib/conflicts';
import type { KanectaItem } from '../../../types/kanecta';

function makeItem(id: string, value: string): KanectaItem {
  return { id, value, type: 'claim', confidence: 'low', sortOrder: 0, tags: [], createdAt: '', modifiedAt: '' };
}

const conflicts: ConflictPair[] = [
  {
    id: 'c1',
    itemA: makeItem('a1', 'Climate change is primarily human-driven'),
    workspaceIdA: 'ws-1',
    itemB: makeItem('b1', 'Climate change has primarily human causes'),
    workspaceIdB: 'ws-2',
    similarity: 0.73,
    reason: 'value-similarity',
  },
  {
    id: 'c2',
    itemA: makeItem('a2', 'Carbon capture is essential for net zero'),
    workspaceIdA: 'ws-1',
    itemB: makeItem('b2', 'Carbon capture essential to achieving net zero goals'),
    workspaceIdB: 'ws-3',
    similarity: 0.68,
    reason: 'value-similarity',
  },
];

const decorator = (Story: React.ComponentType) => (
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
    <ThemeProvider theme={createTheme()}>
      <div style={{ maxWidth: 700, height: 500, overflow: 'auto' }}>
        <Story />
      </div>
    </ThemeProvider>
  </QueryClientProvider>
);

const meta: Meta<typeof ConflictList> = {
  component: ConflictList,
  title: 'Views/ConflictList',
  decorators: [decorator],
};
export default meta;

type Story = StoryObj<typeof ConflictList>;

export const TwoConflicts: Story = {
  args: { conflicts, onResolved: (id) => alert(`Resolved: ${id}`) },
};

export const Empty: Story = {
  args: { conflicts: [] },
};
