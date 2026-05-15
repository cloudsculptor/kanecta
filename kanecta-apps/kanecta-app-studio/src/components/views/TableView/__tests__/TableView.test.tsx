import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ThemeProvider, createTheme } from '@mui/material/styles';
import { TableView } from '../TableView';
import { useUiStore } from '../../../../store/ui';
import { useWorkspaceStore } from '../../../../store/workspace';
import type { KanectaItem, KanectaItemWithChildren } from '../../../../types/kanecta';

const theme = createTheme();

const ITEMS: KanectaItem[] = [
  {
    id: '1', value: 'The speed of light is constant', type: 'fact', confidence: 'verified',
    sortOrder: 0, tags: ['physics'], createdAt: '2024-01-01T00:00:00Z', modifiedAt: '2024-01-01T00:00:00Z',
  },
  {
    id: '2', value: 'Consciousness is an emergent property', type: 'claim', confidence: 'low',
    sortOrder: 1, tags: ['philosophy'], createdAt: '2024-01-02T00:00:00Z', modifiedAt: '2024-01-02T00:00:00Z',
  },
];

const TREE_RESPONSE: KanectaItemWithChildren[] = ITEMS.map((i) => ({ ...i, children: [] }));

function renderTableView(panelId = 'test-panel') {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(
    new Response(JSON.stringify(TREE_RESPONSE), { status: 200 }),
  ));
  return render(
    <QueryClientProvider client={qc}>
      <ThemeProvider theme={theme}>
        <TableView panelId={panelId} />
      </ThemeProvider>
    </QueryClientProvider>,
  );
}

describe('TableView', () => {
  beforeEach(() => {
    useUiStore.setState({
      layout: { panels: [{ id: 'test-panel', viewType: 'table' }], sizes: [100] },
      sidebarState: 'icons',
      rightPanelOpen: false,
      focusedItemId: null,
      filtersByPanel: {},
      sortsByPanel: {},
    });
    useWorkspaceStore.setState({
      workspaces: [{ id: 'primary', name: 'Primary', apiUrl: '/api', colour: '#1976d2', pollIntervalMs: 5000 }],
      activeWorkspaceId: 'primary',
    });
  });

  it('renders items from the API', async () => {
    renderTableView();
    await waitFor(() => {
      expect(screen.getByText('The speed of light is constant')).toBeInTheDocument();
      expect(screen.getByText('Consciousness is an emergent property')).toBeInTheDocument();
    });
  });

  it('shows the filter bar', async () => {
    renderTableView();
    await waitFor(() => {
      expect(screen.getByLabelText('Search items')).toBeInTheDocument();
    });
  });

  it('filters items when type is selected', async () => {
    renderTableView();
    await waitFor(() => screen.getByText('The speed of light is constant'));

    const typeSelect = screen.getByLabelText('Filter by type');
    fireEvent.change(typeSelect, { target: { value: 'fact' } });

    await waitFor(() => {
      expect(screen.getByText('The speed of light is constant')).toBeInTheDocument();
      expect(screen.queryByText('Consciousness is an emergent property')).not.toBeInTheDocument();
    });
  });

  it('focuses an item when a row is clicked', async () => {
    renderTableView();
    await waitFor(() => screen.getByText('The speed of light is constant'));

    fireEvent.click(screen.getByText('The speed of light is constant').closest('tr')!);
    expect(useUiStore.getState().focusedItemId).toBe('1');
    expect(useUiStore.getState().rightPanelOpen).toBe(true);
  });
});
