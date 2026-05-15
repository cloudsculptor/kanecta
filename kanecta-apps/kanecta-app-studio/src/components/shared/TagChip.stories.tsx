import type { Meta, StoryObj } from '@storybook/react';
import { TagChip } from './TagChip';

const meta: Meta<typeof TagChip> = {
  component: TagChip,
  title: 'Shared/TagChip',
};
export default meta;

type Story = StoryObj<typeof TagChip>;

export const Default: Story = { args: { tag: 'philosophy' } };
export const WithRemove: Story = {
  args: { tag: 'removable', onRemove: () => alert('remove clicked') },
};
export const LongTag: Story = { args: { tag: 'very-long-tag-name-here' } };
