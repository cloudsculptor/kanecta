import type { Meta, StoryObj } from '@storybook/react';
import { DndContext } from '@dnd-kit/core';
import { SortableContext } from '@dnd-kit/sortable';
import { BoardCard } from './BoardCard';
import type { KanectaItem } from '../../../types/kanecta';

const item: KanectaItem = {
  id: '1',
  value: 'Build the kanecta knowledge graph UI with full CRUD operations',
  type: 'task',
  confidence: 'high',
  sortOrder: 0,
  tags: ['engineering', 'ui'],
  createdAt: new Date().toISOString(),
  modifiedAt: new Date().toISOString(),
};

const meta: Meta<typeof BoardCard> = {
  component: BoardCard,
  title: 'Views/BoardCard',
  decorators: [
    (Story) => (
      <DndContext>
        <SortableContext items={['1']}>
          <div style={{ width: 240, padding: 8 }}>
            <Story />
          </div>
        </SortableContext>
      </DndContext>
    ),
  ],
};
export default meta;

type Story = StoryObj<typeof BoardCard>;

export const Default: Story = { args: { item } };
export const LowConfidence: Story = { args: { item: { ...item, confidence: 'low', type: 'claim' } } };
export const NoTags: Story = { args: { item: { ...item, tags: [] } } };
