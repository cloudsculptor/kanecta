import type { Meta, StoryObj } from '@storybook/react';
import { userEvent, within, expect } from 'storybook/test';
import { DatastoreSwitcher } from './DatastoreSwitcher';
import { useWorkspaceStore } from '../../store/workspace';

const meta: Meta<typeof DatastoreSwitcher> = {
  component: DatastoreSwitcher,
  title: 'Shell/DatastoreSwitcher',
  parameters: { layout: 'fullscreen' },
  decorators: [
    (Story) => (
      <div style={{ background: '#535754', height: '56px', position: 'relative', display: 'flex', alignItems: 'center' }}>
        <Story />
      </div>
    ),
  ],
};
export default meta;

type Story = StoryObj<typeof DatastoreSwitcher>;

export const Default: Story = {};

export const MultipleWorkspaces: Story = {
  decorators: [
    (Story) => {
      useWorkspaceStore.setState({
        workspaces: [
          { id: 'primary', name: 'Primary', apiUrl: '/api', colour: '#1976d2', pollIntervalMs: 5000 },
          { id: 'linz-trial', name: 'Linz Trial', apiUrl: '/api/linz', colour: '#2e7d32', pollIntervalMs: 5000 },
          { id: 'archive', name: 'Archive', apiUrl: '/api/archive', colour: '#e65100', pollIntervalMs: 5000 },
        ],
        activeWorkspaceId: 'linz-trial',
      });
      return <Story />;
    },
  ],
};

export const PanelOpen: Story = {
  decorators: MultipleWorkspaces.decorators,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const trigger = canvas.getByRole('button', { name: 'Switch datastore' });
    await userEvent.click(trigger);
    await expect(trigger).toHaveAttribute('aria-expanded', 'true');
  },
};
