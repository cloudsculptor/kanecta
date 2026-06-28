import type { Meta, StoryObj } from '@storybook/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { GraphView } from './GraphView';
import type { GraphFlatItem, GraphRelationship } from './GraphView';

const MOCK_ITEMS: GraphFlatItem[] = [
  { id: '1', value: 'Root concept',   type: 'concept',  confidence: 'high',   parentId: null,  childCount: 2 },
  { id: '2', value: 'Task one',       type: 'task',     confidence: 'medium', parentId: '1',   childCount: 1 },
  { id: '3', value: 'Task two',       type: 'task',     confidence: 'low',    parentId: '1',   childCount: 0 },
  { id: '4', value: 'Sub-task A',     type: 'task',     confidence: 'high',   parentId: '2',   childCount: 0 },
  { id: '5', value: 'A note about it', type: 'note',    confidence: 'verified', parentId: null, childCount: 0 },
  { id: '6', value: 'Decision made',  type: 'decision', confidence: 'locked', parentId: null,  childCount: 0 },
  { id: '7', value: 'A question',     type: 'question', confidence: 'low',    parentId: null,  childCount: 0 },
  { id: '8', value: 'Entity A',       type: 'entity',   confidence: 'high',   parentId: null,  childCount: 0 },
];

const MOCK_RELATIONSHIPS: GraphRelationship[] = [
  { fromId: '6', toId: '1', type: 'supports' },
  { fromId: '7', toId: '3', type: 'relates_to' },
  { fromId: '5', toId: '8', type: 'references' },
];

const wrap = (Story: React.ComponentType) => (
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
    <div style={{ width: 800, height: 600, position: 'relative', background: '#fafafa' }}>
      <Story />
    </div>
  </QueryClientProvider>
);

const meta: Meta<typeof GraphView> = {
  component: GraphView,
  title: 'Views/GraphView',
  decorators: [wrap],
};
export default meta;

type Story = StoryObj<typeof GraphView>;

export const Default: Story = {
  args: {
    onFetchItems: async () => MOCK_ITEMS,
    onFetchRelationships: async () => MOCK_RELATIONSHIPS,
    queryKey: 'story',
  },
};

export const WithFocusedItem: Story = {
  args: {
    onFetchItems: async () => MOCK_ITEMS,
    onFetchRelationships: async () => MOCK_RELATIONSHIPS,
    focusedItemId: '1',
    onFocusItem: (id) => console.log('focused', id),
    queryKey: 'story-focused',
  },
};

export const Empty: Story = {
  args: {
    onFetchItems: async () => [],
    onFetchRelationships: async () => [],
    queryKey: 'story-empty',
  },
};
