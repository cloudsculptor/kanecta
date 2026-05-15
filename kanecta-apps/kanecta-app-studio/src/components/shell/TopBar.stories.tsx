import type { Meta, StoryObj } from '@storybook/react';
import { TopBar } from './TopBar';

const meta: Meta<typeof TopBar> = {
  component: TopBar,
  title: 'Shell/TopBar',
  parameters: { layout: 'fullscreen' },
};
export default meta;

type Story = StoryObj<typeof TopBar>;

export const Default: Story = {
  args: {
    onQuickCapture: () => alert('quick capture'),
    onCommandPalette: () => alert('command palette'),
  },
};
