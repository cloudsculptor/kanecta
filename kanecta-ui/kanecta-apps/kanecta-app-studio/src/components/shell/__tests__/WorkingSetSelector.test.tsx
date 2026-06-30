import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { WorkingSetSelector } from '../WorkingSetSelector';
import type { WorkingSet } from '../../../api';

const SAMPLE: WorkingSet[] = [
  {
    name: 'kanecta-internal',
    local: { path: '/data/kanecta-internal', ok: true },
    remotes: {},
    branch: 'main',
    branches: [{ name: 'main', active: true, baseBranch: null }],
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
];

const mockList = vi.fn();
const mockActivate = vi.fn().mockResolvedValue({ ok: true });
const mockSwitchBranch = vi.fn().mockResolvedValue({ ok: true, branch: 'main' });

vi.mock('../../../api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../api')>();
  return {
    ...actual,
    api: {
      workingSets: {
        list: () => mockList(),
        activate: (name: string) => mockActivate(name),
        switchBranch: (name: string, branch: string) => mockSwitchBranch(name, branch),
      },
    },
  };
});

vi.mock('../../../store/workingSet', () => ({
  useWorkingSetStore: () => ({
    workingSets: [
      { id: 'primary', name: 'Kanecta Internal', apiUrl: '/api', colour: '#1976d2', pollIntervalMs: 5000 },
    ],
    activeWorkingSetId: 'primary',
  }),
}));

function Wrapper({ children }: { children: React.ReactNode }) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
}

describe('WorkingSetSelector', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockList.mockResolvedValue({ workingSets: SAMPLE, activeWorkingSet: 'kanecta-internal' });
  });

  it('renders an accessible trigger button', () => {
    render(<WorkingSetSelector />, { wrapper: Wrapper });
    expect(screen.getByRole('button', { name: 'Switch working set' })).toBeInTheDocument();
  });

  it('opens the panel and shows current and available working sets', async () => {
    const user = userEvent.setup();
    render(<WorkingSetSelector />, { wrapper: Wrapper });

    await user.click(screen.getByRole('button', { name: 'Switch working set' }));

    expect(await screen.findByText('Active working set')).toBeInTheDocument();
    expect(screen.getByText('Available working sets')).toBeInTheDocument();
    // Active working set name (humanised from kanecta-internal).
    expect(screen.getAllByText('Kanecta Internal').length).toBeGreaterThan(0);
    // The non-active working set appears in the available list.
    expect(screen.getByText('Work Trial')).toBeInTheDocument();
  });

  it('switches working set via "Make active"', async () => {
    const user = userEvent.setup();
    render(<WorkingSetSelector />, { wrapper: Wrapper });

    await user.click(screen.getByRole('button', { name: 'Switch working set' }));
    const makeActive = await screen.findByText('Make active');
    await user.click(makeActive);

    expect(mockActivate).toHaveBeenCalledWith('work-trial');
  });
});
