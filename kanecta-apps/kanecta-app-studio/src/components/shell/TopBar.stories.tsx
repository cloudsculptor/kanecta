import type { Meta, StoryObj } from '@storybook/react';
import { expect, within } from 'storybook/test';
import { TopBar } from './TopBar';

const meta: Meta<typeof TopBar> = {
  component: TopBar,
  title: 'Shell/TopBar',
  parameters: { layout: 'fullscreen' },
  decorators: [
    (Story) => (
      <div style={{ background: '#535754' }}>
        <Story />
      </div>
    ),
  ],
};
export default meta;

type Story = StoryObj<typeof TopBar>;

export const Default: Story = {
  args: {
    activeView: 'tree',
    onViewSelect: () => {},
    onQuickCapture: () => {},
    onCommandPalette: () => {},
  },
};

export const HomeActive: Story = {
  args: {
    activeView: 'home',
    onViewSelect: () => {},
    onQuickCapture: () => {},
    onCommandPalette: () => {},
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const homeBtn = canvas.getByRole('button', { name: 'Home' });
    await expect(homeBtn).toHaveAttribute('aria-current', 'page');
    const style = window.getComputedStyle(homeBtn);
    await expect(style.borderRadius).toBe('0px');
  },
};
