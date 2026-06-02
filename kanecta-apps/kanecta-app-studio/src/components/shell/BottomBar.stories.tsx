import type { Meta, StoryObj } from '@storybook/react';
import { expect, within } from 'storybook/test';
import { LocationProvider } from '../../context/LocationContext';
import { BottomBar } from './BottomBar';

const meta: Meta<typeof BottomBar> = {
  component: BottomBar,
  title: 'Shell/BottomBar',
  parameters: { layout: 'fullscreen' },
  decorators: [(Story) => <LocationProvider><Story /></LocationProvider>],
};
export default meta;

type Story = StoryObj<typeof BottomBar>;

export const Default: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByRole('button', { name: 'Home' })).toBeInTheDocument();
    await expect(canvas.queryByPlaceholderText('View')).not.toBeInTheDocument();
    await expect(canvas.queryByPlaceholderText('Item')).not.toBeInTheDocument();
  },
};
