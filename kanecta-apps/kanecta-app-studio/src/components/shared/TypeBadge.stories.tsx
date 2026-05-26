import type { Meta, StoryObj } from '@storybook/react';
import { TypeBadge } from './TypeBadge';

const meta: Meta<typeof TypeBadge> = {
  component: TypeBadge,
  title: 'Shared/TypeBadge',
};
export default meta;

type Story = StoryObj<typeof TypeBadge>;

export const Claim: Story = { args: { type: 'claim' } };
export const Task: Story = { args: { type: 'task' } };
export const Note: Story = { args: { type: 'note' } };
export const Concept: Story = { args: { type: 'concept' } };

export const AllTypes: Story = {
  render: () => (
    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
      {(['claim', 'question', 'task', 'note', 'concept', 'entity', 'event', 'text', 'code', 'url'] as const).map((t) => (
        <TypeBadge key={t} type={t} />
      ))}
    </div>
  ),
};
