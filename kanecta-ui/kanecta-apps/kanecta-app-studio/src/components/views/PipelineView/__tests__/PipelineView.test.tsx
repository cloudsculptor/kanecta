import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { PipelineRunSummary, buildRuns, type RunView } from '../PipelineView';

const RUN: RunView = {
  id: 'run-1',
  runName: 'Dev · Run 1',
  pipelineName: 'Dev',
  status: 'running',
  startedAt: '2026-07-02T09:00:00Z',
  completedAt: null,
  phases: [
    { id: 'a', name: 'Phase A', status: 'complete', startedAt: '2026-07-02T09:00:00Z', completedAt: '2026-07-02T09:01:00Z' },
    { id: 'b', name: 'Phase B', status: 'running', startedAt: '2026-07-02T09:01:00Z', completedAt: null },
    { id: 'c', name: 'Phase C', status: 'pending' },
  ],
};

describe('PipelineRunSummary', () => {
  it('renders the run, phase names, progress and status badge', () => {
    render(<PipelineRunSummary run={RUN} />);
    expect(screen.getByText('Dev · Run 1')).toBeInTheDocument();
    expect(screen.getByText('Phase A')).toBeInTheDocument();
    expect(screen.getByText('Phase C')).toBeInTheDocument();
    expect(screen.getByText(/1\/3 phases/)).toBeInTheDocument();
    expect(screen.getByText('running', { selector: '.PipelineView__badge' })).toBeInTheDocument();
  });

  it('marks the running phase with a spinning glyph', () => {
    const { container } = render(<PipelineRunSummary run={RUN} />);
    expect(container.querySelector('.PipelineView__glyph--spin')).toBeTruthy();
  });
});

describe('buildRuns', () => {
  const items = [
    { id: 'p1', value: 'Dev', type: 'pipeline' },
    { id: 'r1', value: 'Dev · Run 1', type: 'pipeline-run', parentId: 'p1' },
    { id: 'x', value: 'ignore me', type: 'text' },
  ];

  it('joins a run to its pipeline and resolves phase names from the snapshot', () => {
    const runs = buildRuns(
      items,
      {
        r1: {
          status: 'running',
          phases: [
            { phaseId: 'a', status: 'complete' },
            { phaseId: 'b', status: 'running' },
          ],
          pipelineSnapshot: { phases: [{ id: 'a', name: 'Alpha' }, { id: 'b', name: 'Beta' }] },
        },
      },
      {},
    );
    expect(runs).toHaveLength(1);
    expect(runs[0].pipelineName).toBe('Dev');
    expect(runs[0].phases.map((p) => p.name)).toEqual(['Alpha', 'Beta']);
    expect(runs[0].status).toBe('running');
  });

  it('falls back to the pipeline payload phases when no snapshot exists', () => {
    const runs = buildRuns(
      items,
      { r1: { status: 'pending', phases: [{ phaseId: 'a', status: 'pending' }] } },
      { p1: { phases: [{ id: 'a', name: 'Alpha' }] } },
    );
    expect(runs[0].phases[0].name).toBe('Alpha');
  });

  it('ignores non-pipeline items', () => {
    const runs = buildRuns(items, { r1: { status: 'pending', phases: [] } }, {});
    expect(runs.every((r) => r.id !== 'x')).toBe(true);
  });
});
