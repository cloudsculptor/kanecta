import type { Meta, StoryObj } from '@storybook/react';
import { ConfidenceBadge } from './ConfidenceBadge';

const meta: Meta<typeof ConfidenceBadge> = {
  component: ConfidenceBadge,
  title: 'Shared/ConfidenceBadge',
};
export default meta;

type Story = StoryObj<typeof ConfidenceBadge>;

export const Low: Story = { args: { confidence: 'low' } };
export const Medium: Story = { args: { confidence: 'medium' } };
export const High: Story = { args: { confidence: 'high' } };
export const Verified: Story = { args: { confidence: 'verified' } };
export const Locked: Story = { args: { confidence: 'locked' } };

export const AllBadges: Story = {
  render: () => (
    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
      {(['low', 'medium', 'high', 'verified', 'locked'] as const).map((c) => (
        <ConfidenceBadge key={c} confidence={c} />
      ))}
    </div>
  ),
};
