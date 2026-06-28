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
          { id: 'work-trial', name: 'Work Trial', apiUrl: '/api/work', colour: '#2e7d32', pollIntervalMs: 5000 },
          { id: 'archive', name: 'Archive', apiUrl: '/api/archive', colour: '#e65100', pollIntervalMs: 5000 },
        ],
        activeWorkspaceId: 'work-trial',
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

// Visual regression baseline — captures the full panel UI before and after wiring.
// This story must continue to pass after real data replaces the mock constants.
export const PanelFullVisualBaseline: Story = {
  decorators: MultipleWorkspaces.decorators,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    // Open the panel
    const trigger = canvas.getByRole('button', { name: 'Switch datastore' });
    await userEvent.click(trigger);
    await expect(trigger).toHaveAttribute('aria-expanded', 'true');

    // Structural sections must be present
    await expect(canvas.getByText('Active working set')).toBeInTheDocument();
    await expect(canvas.getByText('Available working sets')).toBeInTheDocument();

    // Active working set must show name, cloud row, local row, branches heading
    await expect(canvas.getByText('Kanecta Internal')).toBeInTheDocument();
    await expect(canvas.getByText('Branches')).toBeInTheDocument();

    // Branch list must include the active branch indicator (⎇ glyph)
    const branchGlyphs = canvas.getAllByText('⎇');
    await expect(branchGlyphs.length).toBeGreaterThan(0);

    // Sync status row must be present (push indicator)
    await expect(canvas.getByText(/↑/)).toBeInTheDocument();

    // Available list must have at least one item
    await expect(canvas.getAllByText('Make active').length).toBeGreaterThan(0);

    // Create PR action must be present
    await expect(canvas.getByText('Create Pull Request')).toBeInTheDocument();
  },
};
