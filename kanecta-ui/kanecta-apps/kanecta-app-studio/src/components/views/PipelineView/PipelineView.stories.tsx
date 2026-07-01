import type { Meta, StoryObj } from '@storybook/react';
import { within, expect } from 'storybook/test';
import { PipelineRunSummary, type RunView } from './PipelineView';

const now = Date.parse('2026-07-02T09:00:00Z');
const iso = (offsetSecs: number) => new Date(now + offsetSecs * 1000).toISOString();

const RUNNING: RunView = {
  id: 'run-1',
  pipelineId: 'pipe-1',
  runName: 'Pipeline View — build & dogfood · Run 1',
  pipelineName: 'Pipeline View',
  status: 'running',
  startedAt: iso(0),
  completedAt: null,
  phases: [
    { id: 'inspect', name: 'Inspect live pipeline data', status: 'complete', startedAt: iso(0), completedAt: iso(90),
      log: 'Reading the pipeline + pipeline-run type definitions…\n↳ Bash: node -e "…loadAll()…"\nFound 0 pipeline instances — seeding a live demo.\n↳ Write: pipeline-dev-tracker.js' },
    { id: 'build', name: 'Build PipelineView (GH Actions look)', status: 'complete', startedAt: iso(90), completedAt: iso(420) },
    { id: 'wire', name: 'Register view + LeftBar', status: 'running', startedAt: iso(420), completedAt: null },
    { id: 'seed', name: 'Seed live pipeline + run', status: 'pending' },
    { id: 'drive', name: 'Drive the run as I work', status: 'pending' },
  ],
};

const FAILED: RunView = {
  id: 'run-2',
  pipelineId: 'pipe-2',
  runName: 'Nightly audit · Run 42',
  pipelineName: 'Nightly audit',
  status: 'failed',
  startedAt: iso(0),
  completedAt: iso(200),
  phases: [
    { id: 'collect', name: 'Collect changed items', status: 'complete', startedAt: iso(0), completedAt: iso(40) },
    { id: 'analyse', name: 'Analyse blast radius', status: 'failed', startedAt: iso(40), completedAt: iso(200) },
    { id: 'report', name: 'Publish report', status: 'skipped' },
  ],
};

const meta: Meta<typeof PipelineRunSummary> = {
  component: PipelineRunSummary,
  title: 'Views/PipelineView',
  parameters: { layout: 'padded' },
};
export default meta;

type Story = StoryObj<typeof PipelineRunSummary>;

export const Running: Story = {
  args: { run: RUNNING },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByText('Inspect live pipeline data')).toBeInTheDocument();
    await expect(canvas.getByText('3/5 phases')).toBeInTheDocument();
  },
};

export const Failed: Story = {
  args: { run: FAILED },
};

export const Multiple: Story = {
  render: () => (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16, maxWidth: 900 }}>
      <PipelineRunSummary run={RUNNING} />
      <PipelineRunSummary run={FAILED} />
    </div>
  ),
};
