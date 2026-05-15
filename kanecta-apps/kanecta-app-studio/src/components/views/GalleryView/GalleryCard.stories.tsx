import type { Meta, StoryObj } from '@storybook/react';
import { GalleryCard } from './GalleryCard';
import type { KanectaItem } from '../../../types/kanecta';

const item: KanectaItem = {
  id: '1',
  value: 'The hard problem of consciousness remains unsolved despite decades of philosophy and neuroscience',
  type: 'claim',
  confidence: 'medium',
  sortOrder: 0,
  tags: ['philosophy', 'consciousness', 'neuroscience'],
  createdAt: new Date().toISOString(),
  modifiedAt: new Date().toISOString(),
};

const meta: Meta<typeof GalleryCard> = {
  component: GalleryCard,
  title: 'Views/GalleryCard',
  decorators: [(Story) => <div style={{ width: 260, padding: 8 }}><Story /></div>],
};
export default meta;

type Story = StoryObj<typeof GalleryCard>;

export const Default: Story = { args: { item } };
export const ShortValue: Story = { args: { item: { ...item, value: 'Quick task', type: 'task', tags: [] } } };
export const ManyTags: Story = { args: { item: { ...item, tags: ['tag1', 'tag2', 'tag3', 'tag4', 'tag5'] } } };
export const HighConfidence: Story = { args: { item: { ...item, confidence: 'locked' } } };
