import type { Meta, StoryObj } from '@storybook/react';
import { expect, within } from 'storybook/test';
import { RightBar } from './RightBar';

const meta: Meta<typeof RightBar> = {
  component: RightBar,
  title: 'Shell/RightBar',
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

type Story = StoryObj<typeof RightBar>;

export const Default: Story = {
  args: { activeView: 'list', onViewSelect: () => {} },
};

export const ActiveItem: Story = {
  args: { activeView: 'list', onViewSelect: () => {} },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const activeBtn = canvas.getByRole('button', { name: 'List' });
    await expect(activeBtn).toHaveAttribute('aria-current', 'page');
    const style = window.getComputedStyle(activeBtn);
    await expect(style.borderRadius).toBe('0px');
  },
};
