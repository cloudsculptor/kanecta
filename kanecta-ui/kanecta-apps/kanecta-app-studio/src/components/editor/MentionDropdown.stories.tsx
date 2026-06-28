import type { Meta, StoryObj } from '@storybook/react';
import { MentionDropdown } from './MentionDropdown';
import type { KanectaItem } from '../../types/kanecta';

const items: KanectaItem[] = [
  { id: '1', value: 'Climate change causes sea level rise', type: 'claim', confidence: 'high', sortOrder: 0, tags: [], createdAt: '', modifiedAt: '' },
  { id: '2', value: 'Carbon emissions are the main driver', type: 'claim', confidence: 'medium', sortOrder: 1, tags: [], createdAt: '', modifiedAt: '' },
  { id: '3', value: 'What are the tipping points?', type: 'question', confidence: 'low', sortOrder: 2, tags: [], createdAt: '', modifiedAt: '' },
  { id: '4', value: 'Reduce personal carbon footprint', type: 'task', confidence: 'medium', sortOrder: 3, tags: [], createdAt: '', modifiedAt: '' },
];

const meta: Meta<typeof MentionDropdown> = {
  component: MentionDropdown,
  title: 'Editor/MentionDropdown',
  decorators: [
    (Story) => (
      <div style={{ padding: 16, background: '#f5f5f5', minHeight: 200 }}>
        <Story />
      </div>
    ),
  ],
};
export default meta;

type Story = StoryObj<typeof MentionDropdown>;

export const WithResults: Story = {
  args: {
    items,
    command: (item) => alert(`Mentioned: ${item.id}`),
  },
};

export const NoResults: Story = {
  args: {
    items: [],
    command: () => {},
  },
};
