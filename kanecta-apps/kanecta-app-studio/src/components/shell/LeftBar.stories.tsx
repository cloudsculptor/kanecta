import type { Meta, StoryObj } from '@storybook/react';
import { expect, within } from 'storybook/test';
import { LeftBar } from './LeftBar';

const meta: Meta<typeof LeftBar> = {
  component: LeftBar,
  title: 'Shell/LeftBar',
  parameters: { layout: 'fullscreen' },
  decorators: [
    (Story) => (
      <div style={{ display: 'flex', height: '100vh', background: '#535754' }}>
        <Story />
      </div>
    ),
  ],
};
export default meta;

type Story = StoryObj<typeof LeftBar>;

export const Default: Story = {
  args: { activeView: 'tree', onViewSelect: () => {} },
};

export const ActiveItem: Story = {
  args: { activeView: 'tree', onViewSelect: () => {} },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const activeBtn = canvas.getByRole('button', { name: 'Tree' });
    await expect(activeBtn).toHaveAttribute('aria-current', 'page');
    const style = window.getComputedStyle(activeBtn);
    await expect(style.borderRadius).toBe('0px');
  },
};
