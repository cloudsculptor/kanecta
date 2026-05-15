import type { Meta, StoryObj } from '@storybook/react';
import { RightPanel } from './RightPanel';

const meta: Meta<typeof RightPanel> = {
  component: RightPanel,
  title: 'Shell/RightPanel',
  parameters: { layout: 'fullscreen' },
  decorators: [(Story) => <div style={{ height: '100vh', display: 'flex', justifyContent: 'flex-end' }}><Story /></div>],
};
export default meta;

type Story = StoryObj<typeof RightPanel>;

export const Open: Story = {
  args: { open: true, title: 'Quantum entanglement', onClose: () => {} },
};
export const WithContent: Story = {
  args: {
    open: true,
    title: 'Item detail',
    onClose: () => {},
    children: <div style={{ padding: 16 }}>Item metadata would go here</div>,
  },
};
export const Closed: Story = {
  args: { open: false, onClose: () => {} },
};
