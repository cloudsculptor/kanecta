import type { Meta, StoryObj } from '@storybook/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { userEvent, within, expect } from 'storybook/test';
import { WorkingSetSelector } from './WorkingSetSelector';
import { useWorkingSetStore } from '../../store/workingSet';
import type { WorkingSet } from '../../api';

const SAMPLE_WORKING_SETS: WorkingSet[] = [
  {
    name: 'kanecta-internal',
    local: { path: '/data/kanecta-internal', ok: true },
    remotes: { origin: { type: 'postgres', host: 'db.kanecta.dev', database: 'kanecta' } },
    branch: 'main',
    branches: [
      { name: 'main', active: true, baseBranch: null },
      { name: 'experiment', active: false, baseBranch: 'main' },
    ],
    isActive: true,
  },
  {
    name: 'work-trial',
    local: { path: '/data/work-trial', ok: true },
    remotes: {},
    branch: 'main',
    branches: [{ name: 'main', active: true, baseBranch: null }],
    isActive: false,
  },
  {
    name: 'archive',
    local: { path: '/data/archive', ok: true },
    remotes: {},
    branch: 'main',
    branches: [{ name: 'main', active: true, baseBranch: null }],
    isActive: false,
  },
];

/**
 * Build a QueryClient pre-seeded with the `working-sets` query so the
 * component renders deterministically without a live backend.
 */
function makeSeededClient(workingSets: WorkingSet[] = SAMPLE_WORKING_SETS) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const active = workingSets.find((w) => w.isActive)?.name ?? '';
  client.setQueryData(['working-sets'], { workingSets, activeWorkingSet: active });
  return client;
}

const meta: Meta<typeof WorkingSetSelector> = {
  component: WorkingSetSelector,
  title: 'Shell/WorkingSetSelector',
  parameters: { layout: 'fullscreen' },
  decorators: [
    (Story) => {
      useWorkingSetStore.setState({
        workingSets: [
          { id: 'primary', name: 'Kanecta Internal', apiUrl: '/api', colour: '#1976d2', pollIntervalMs: 5000 },
        ],
        activeWorkingSetId: 'primary',
      });
      return (
        <QueryClientProvider client={makeSeededClient()}>
          <div style={{ background: '#535754', height: '56px', position: 'relative', display: 'flex', alignItems: 'center' }}>
            <Story />
          </div>
        </QueryClientProvider>
      );
    },
  ],
};
export default meta;

type Story = StoryObj<typeof WorkingSetSelector>;

export const Default: Story = {};

export const PanelOpen: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const trigger = canvas.getByRole('button', { name: 'Switch working set' });
    await userEvent.click(trigger);
    await expect(trigger).toHaveAttribute('aria-expanded', 'true');
  },
};

// Visual regression baseline — captures the full panel UI.
export const PanelFullVisualBaseline: Story = {
  play: async ({ canvasElement }) => {
    const body = within(canvasElement.ownerDocument.body);
    const canvas = within(canvasElement);

    const trigger = canvas.getByRole('button', { name: 'Switch working set' });
    await userEvent.click(trigger);
    await expect(trigger).toHaveAttribute('aria-expanded', 'true');

    // Structural sections must be present (Popover renders into body).
    await expect(body.getByText('Active working set')).toBeInTheDocument();
    await expect(body.getByText('Available working sets')).toBeInTheDocument();

    // Active working set name + branches heading.
    await expect(body.getByText('Kanecta Internal')).toBeInTheDocument();
    await expect(body.getByText('Branches')).toBeInTheDocument();

    // Branch list must include the active branch indicator (⎇ glyph).
    const branchGlyphs = body.getAllByText('⎇');
    await expect(branchGlyphs.length).toBeGreaterThan(0);

    // Available list must include the non-active working sets.
    const makeActive = body.getAllByText('Make active');
    await expect(makeActive.length).toBe(2);

    // Create PR action must be present.
    await expect(body.getByText('Create Pull Request')).toBeInTheDocument();
  },
};
