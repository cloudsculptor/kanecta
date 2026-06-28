import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ThemeProvider, createTheme } from '@mui/material/styles';
import { ReviewConveyor } from '../ReviewConveyor';
import { useReviewStore } from '../../../../store/review';
import type { KanectaItem } from '../../../../types/kanecta';

function makeItem(id: string, value: string): KanectaItem {
  return { id, value, type: 'claim', confidence: 'low', sortOrder: 0, tags: [], createdAt: new Date().toISOString(), modifiedAt: new Date().toISOString() };
}

const mockUpdate = vi.fn().mockResolvedValue({ id: 'x' });
const mockDelete = vi.fn().mockResolvedValue({ deleted: 'x' });

vi.mock('../../../../store/workspace', () => ({
  useWorkspaceStore: () => ({
    getApi: () => ({ items: { update: mockUpdate, delete: mockDelete } }),
    workspaces: [{ id: 'ws-1', name: 'Primary', colour: '#1976d2', apiUrl: '/api', pollIntervalMs: 5000 }],
  }),
}));

const items = [
  makeItem('item-1', 'First claim to review'),
  makeItem('item-2', 'Second claim to review'),
  makeItem('item-3', 'Third claim to review'),
];

const theme = createTheme();

function Wrapper({ children }: { children: React.ReactNode }) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return (
    <QueryClientProvider client={qc}>
      <ThemeProvider theme={theme}>{children}</ThemeProvider>
    </QueryClientProvider>
  );
}

describe('ReviewConveyor', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useReviewStore.setState({ reviewQueue: items, conveyorIndex: 0, seenItemIds: new Set() });
  });

  it('renders the first item in the queue', () => {
    render(<ReviewConveyor onClose={() => {}} />, { wrapper: Wrapper });
    expect(screen.getByText('First claim to review')).toBeInTheDocument();
  });

  it('shows progress counter', () => {
    render(<ReviewConveyor onClose={() => {}} />, { wrapper: Wrapper });
    expect(screen.getByText(/1 \/ 3/)).toBeInTheDocument();
  });

  it('Skip button advances without API call', async () => {
    render(<ReviewConveyor onClose={() => {}} />, { wrapper: Wrapper });
    await userEvent.click(screen.getByText(/Skip/));
    expect(screen.getByText('Second claim to review')).toBeInTheDocument();
    expect(mockUpdate).not.toHaveBeenCalled();
    expect(mockDelete).not.toHaveBeenCalled();
  });

  it('Approve calls update with confidence=high and advances', async () => {
    render(<ReviewConveyor onClose={() => {}} />, { wrapper: Wrapper });
    await userEvent.click(screen.getByText(/Approve/));
    expect(mockUpdate).toHaveBeenCalledWith('item-1', { confidence: 'high' });
    await act(async () => {});
    expect(screen.getByText('Second claim to review')).toBeInTheDocument();
  });

  it('Delete calls items.delete and advances', async () => {
    render(<ReviewConveyor onClose={() => {}} />, { wrapper: Wrapper });
    await userEvent.click(screen.getByText(/Delete/));
    expect(mockDelete).toHaveBeenCalledWith('item-1');
    await act(async () => {});
    expect(screen.getByText('Second claim to review')).toBeInTheDocument();
  });

  it('A key approves via keyboard', async () => {
    render(<ReviewConveyor onClose={() => {}} />, { wrapper: Wrapper });
    await act(async () => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'a', bubbles: true }));
    });
    expect(mockUpdate).toHaveBeenCalledWith('item-1', { confidence: 'high' });
  });

  it('D key deletes via keyboard', async () => {
    render(<ReviewConveyor onClose={() => {}} />, { wrapper: Wrapper });
    await act(async () => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'd', bubbles: true }));
    });
    expect(mockDelete).toHaveBeenCalledWith('item-1');
  });

  it('ArrowRight skips via keyboard', async () => {
    render(<ReviewConveyor onClose={() => {}} />, { wrapper: Wrapper });
    await act(async () => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
    });
    expect(screen.getByText('Second claim to review')).toBeInTheDocument();
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it('Escape calls onClose', async () => {
    const onClose = vi.fn();
    render(<ReviewConveyor onClose={onClose} />, { wrapper: Wrapper });
    await act(async () => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    });
    expect(onClose).toHaveBeenCalled();
  });

  it('shows done state when all items reviewed', () => {
    useReviewStore.setState({ reviewQueue: items, conveyorIndex: items.length });
    render(<ReviewConveyor onClose={() => {}} />, { wrapper: Wrapper });
    expect(screen.getByText(/all items reviewed/i)).toBeInTheDocument();
  });

  it('close button calls onClose', async () => {
    const onClose = vi.fn();
    render(<ReviewConveyor onClose={onClose} />, { wrapper: Wrapper });
    await userEvent.click(screen.getByLabelText('Close review'));
    expect(onClose).toHaveBeenCalled();
  });
});
