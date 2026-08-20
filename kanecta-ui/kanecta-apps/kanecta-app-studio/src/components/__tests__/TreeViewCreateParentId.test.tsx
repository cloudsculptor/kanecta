import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { ReactNode } from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ThemeProvider, createTheme } from '@mui/material/styles';
import { TreeView } from '@kanecta/component-tree-view';
import type { TreeViewApi, KanectaItem } from '@kanecta/component-tree-view';

/**
 * Regression test for the tree "add node" create call (PR #170).
 *
 * The storage layer requires an explicit parentId on create — nothing is
 * inferred for content items. The add-node row used to omit it (it sent the
 * zoom root, which is null at the top level), so the everyday "add a primitive
 * under the item you're on" flow returned HTTP 400 "parentId is required".
 * The fix sends the current location — the focusedItemId prop — as the new
 * item's parentId. This test clicks the add-node row and asserts the create
 * payload carries the focused item's id.
 */

const FOCUSED_ID = '22222222-2222-4222-8222-222222222222';

function makeItem(
  partial: Partial<KanectaItem> & { id: string; value: string },
): KanectaItem {
  return {
    type: 'text',
    typeId: null,
    confidence: null,
    parentId: null,
    sortOrder: 0,
    tags: [],
    createdAt: null,
    modifiedAt: null,
    childCount: 0,
    ...partial,
  };
}

const createSpy = vi.fn(async (payload: { value: string; type: string; parentId?: string }) =>
  makeItem({ id: 'new-1', value: payload.value, parentId: payload.parentId ?? null }),
);

function makeApi(): TreeViewApi {
  const ok = async () => ({ ok: true });
  const api = {
    items: {
      list: vi.fn(async () => []),
      root: vi.fn(async () => makeItem({ id: 'root-1', value: 'Root', type: 'root' })),
      get: vi.fn(async (id: string) => makeItem({ id, value: 'Root', type: 'root' })),
      children: vi.fn(async () => []),
      tree: vi.fn(async () => []),
      create: createSpy,
      update: vi.fn(async (id: string) => makeItem({ id, value: '' })),
      delete: vi.fn(async () => ({ deleted: 'x' })),
      getObject: vi.fn(async () => ({})),
      getFunctionData: vi.fn(async () => null),
      saveFunctionData: vi.fn(ok),
      checkFunctionScaffold: vi.fn(async () => ({})),
      compileFunctionScaffold: vi.fn(async () => ({})),
      runFunctionScaffold: vi.fn(async () => ({})),
      getFunctionPackageJson: vi.fn(async () => ({})),
    },
    aliases: {
      list: vi.fn(async () => []),
      listForItem: vi.fn(async () => []),
      resolve: vi.fn(async () => ({})),
      set: vi.fn(async () => ({})),
      remove: vi.fn(async () => ({ removed: 'x' })),
    },
    config: {
      get: vi.fn(async () => ({ datastorePath: '/tmp', vscodeAvailable: false })),
      openPath: vi.fn(ok),
      openInBrowser: vi.fn(ok),
      openInVscode: vi.fn(ok),
    },
    breadcrumb: { addClipboard: vi.fn(ok), addViewed: vi.fn(ok) },
    starred: { list: vi.fn(async () => []), add: vi.fn(ok), remove: vi.fn(ok) },
    view: { get: vi.fn(async () => null), save: vi.fn(ok) },
    types: { schema: vi.fn(async () => ({})) },
    tree: { full: vi.fn(async () => []) },
    documents: {
      listForTarget: vi.fn(async () => []),
      create: vi.fn(async () => ({ id: 'doc-1' })),
      update: vi.fn(ok),
    },
  };
  return api as unknown as TreeViewApi;
}

function Wrapper({ children }: { children: ReactNode }) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return (
    <QueryClientProvider client={qc}>
      <ThemeProvider theme={createTheme()}>{children}</ThemeProvider>
    </QueryClientProvider>
  );
}

describe('TreeView add node — explicit parentId (PR #170)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('creates the primitive under the focused item, not with a missing parentId', async () => {
    const { container } = render(
      <TreeView panelId="p1" api={makeApi()} focusedItemId={FOCUSED_ID} />,
      { wrapper: Wrapper },
    );

    // The add-node row is the trailing TreeNode-row in the content area
    // (the list is empty, so it is the only one).
    await screen.findByText('No items yet');
    const addRow = container.querySelector('.TreeView-content .TreeNode-row');
    expect(addRow).not.toBeNull();
    await userEvent.click(addRow!);

    await waitFor(() => expect(createSpy).toHaveBeenCalledTimes(1));
    expect(createSpy).toHaveBeenCalledWith({
      value: '',
      type: 'text',
      parentId: FOCUSED_ID,
    });
  });
});
