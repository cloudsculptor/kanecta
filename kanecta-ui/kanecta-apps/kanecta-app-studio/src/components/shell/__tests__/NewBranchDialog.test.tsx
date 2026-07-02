import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { NewBranchDialog } from '../NewBranchDialog';

const mockCreateBranch = vi.fn().mockResolvedValue({ ok: true, branch: {} });

vi.mock('../../../api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../api')>();
  return {
    ...actual,
    api: { workingSets: { createBranch: (...a: unknown[]) => mockCreateBranch(...a) } },
  };
});

function Wrapper({ children }: { children: React.ReactNode }) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
}

function renderDialog(overrides: Partial<React.ComponentProps<typeof NewBranchDialog>> = {}) {
  const onCreated = vi.fn();
  const onClose = vi.fn();
  render(
    <NewBranchDialog
      open
      onClose={onClose}
      workingSetName="kanecta-internal"
      branches={['main', 'experiment']}
      currentBranch="main"
      onCreated={onCreated}
      {...overrides}
    />,
    { wrapper: Wrapper },
  );
  return { onCreated, onClose };
}

describe('NewBranchDialog', () => {
  beforeEach(() => vi.clearAllMocks());

  it('creates a full branch by default and reports the new name', async () => {
    const user = userEvent.setup();
    const { onCreated } = renderDialog();

    await user.type(screen.getByLabelText('Branch name'), 'feature/x');
    await user.click(screen.getByRole('button', { name: 'Create branch' }));

    expect(mockCreateBranch).toHaveBeenCalledWith('kanecta-internal', 'feature/x', { fill: 'full' });
    expect(onCreated).toHaveBeenCalledWith('feature/x');
  });

  it('creates a sparse branch tracking the chosen upstream', async () => {
    const user = userEvent.setup();
    renderDialog();

    await user.type(screen.getByLabelText('Branch name'), 'feature/y');
    await user.click(screen.getByRole('radio', { name: /Sparse/ }));
    // Upstream defaults to the current branch ('main').
    await user.click(screen.getByRole('button', { name: 'Create branch' }));

    expect(mockCreateBranch).toHaveBeenCalledWith('kanecta-internal', 'feature/y', {
      fill: 'sparse',
      upstream: { branch: 'main' },
    });
  });

  it('blocks a name that clashes with an existing branch', async () => {
    const user = userEvent.setup();
    renderDialog();

    await user.type(screen.getByLabelText('Branch name'), 'experiment');
    expect(screen.getByText('Branch "experiment" already exists')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Create branch' })).toBeDisabled();
    expect(mockCreateBranch).not.toHaveBeenCalled();
  });

  it('reveals the upstream selector only for a sparse branch', async () => {
    const user = userEvent.setup();
    renderDialog();

    expect(screen.queryByLabelText('Upstream branch')).not.toBeInTheDocument();
    await user.click(screen.getByRole('radio', { name: /Sparse/ }));
    expect(screen.getByLabelText('Upstream branch')).toBeInTheDocument();
  });
});
