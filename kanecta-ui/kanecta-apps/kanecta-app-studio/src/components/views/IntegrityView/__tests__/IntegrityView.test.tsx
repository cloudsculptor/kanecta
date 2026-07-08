import { describe, it, expect } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { IntegrityView, type IntegrityRunner, type IntegrityEvent } from '@kanecta/component-integrity-view';

const MANIFEST: IntegrityEvent = {
  type: 'manifest',
  total: 2,
  checks: [
    { id: 'id-is-uuid', title: 'Every item id is a valid UUID', group: 'structure', specRef: '' },
    { id: 'parentid-resolves', title: 'Every parentId resolves to an existing item', group: 'tree', specRef: '' },
  ],
};

// Emits manifest, then a pass and a fail result, then done — all synchronously.
const runner: IntegrityRunner = async ({ onEvent }) => {
  onEvent(MANIFEST);
  onEvent({ type: 'result', index: 0, result: { id: 'id-is-uuid', title: 'Every item id is a valid UUID', group: 'structure', specRef: '', status: 'pass', findings: [], count: 0 } });
  onEvent({ type: 'result', index: 1, result: { id: 'parentid-resolves', title: 'Every parentId resolves to an existing item', group: 'tree', specRef: '', status: 'fail', count: 1, findings: [{ severity: 'error', message: 'item X has a dangling parentId', fix: 're-parent it' }] } });
  onEvent({ type: 'done', summary: { total: 2, passed: 1, failed: 1, skipped: 0, errorCount: 1, warnCount: 0, ok: false } });
};

describe('IntegrityView (package component)', () => {
  it('renders the checklist and flips ticks as results arrive', async () => {
    render(<IntegrityView run={runner} />);
    // Idle prompt before running.
    expect(screen.getByText(/Press .Run check/)).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: /run check/i }));

    // Both check rows render.
    expect(await screen.findByText('Every item id is a valid UUID')).toBeInTheDocument();
    expect(screen.getByText('Every parentId resolves to an existing item')).toBeInTheDocument();

    // The failing check surfaces its finding + fix, and the summary badge shows the error count.
    await waitFor(() => {
      expect(screen.getByText(/item X has a dangling parentId/)).toBeInTheDocument();
      expect(screen.getByText(/1 error/)).toBeInTheDocument();
    });
  });

  it('auto-runs on mount when autoRun is set', async () => {
    render(<IntegrityView run={runner} autoRun />);
    expect(await screen.findByText('Every item id is a valid UUID')).toBeInTheDocument();
    await waitFor(() => expect(screen.getByText(/1 error/)).toBeInTheDocument());
  });
});
