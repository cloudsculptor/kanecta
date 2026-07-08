import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { ReactNode } from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ThemeProvider, createTheme } from '@mui/material/styles';
import { TreeView } from '@kanecta/component-tree-view';
import type { TreeViewApi, KanectaItem } from '@kanecta/component-tree-view';

/**
 * Regression test for Bug F fix #1.
 *
 * TreeView.handleEdit persists an inline edit via updateMutation, whose
 * onSuccess only invalidates ['item', id] — never the ['tree-children',
 * parentId] list the tree actually renders from. Without the extra
 * invalidate(item.parentId) the edited value visually reverts to the stale
 * cached value until some unrelated refetch. This test drives a real inline
 * edit and asserts the new value is reflected immediately (i.e. the
 * tree-children list was refetched).
 */

const CHILD_ID = 'child-1';

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

// Mutable so a refetch after the edit returns the updated text.
let childValue: string;

const updateSpy = vi.fn(async (_id: string, payload: { value?: string }) => {
  if (payload.value != null) childValue = payload.value;
  return makeItem({ id: CHILD_ID, value: childValue });
});

// Top-level list (rootId === null path) — the child's parentId is null, so
// invalidate(null) targets this exact query key.
const listSpy = vi.fn(async () => [
  makeItem({ id: CHILD_ID, value: childValue, parentId: null }),
]);

function makeApi(): TreeViewApi {
  const ok = async () => ({ ok: true });
  const api = {
    items: {
      list: listSpy,
      root: vi.fn(async () => makeItem({ id: 'root-1', value: 'Root', type: 'root' })),
      get: vi.fn(async (id: string) => makeItem({ id, value: 'Root', type: 'root' })),
      children: vi.fn(async () => []),
      tree: vi.fn(async () => []),
      create: vi.fn(async () => makeItem({ id: 'new-1', value: '' })),
      update: updateSpy,
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

describe('TreeView inline edit (Bug F fix #1)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    childValue = 'original';
  });

  it('reflects an inline edit immediately by refetching the tree-children list', async () => {
    render(<TreeView panelId="p1" api={makeApi()} />, { wrapper: Wrapper });

    // Initial list renders the child.
    const label = await screen.findByText('original');
    const listCallsBefore = listSpy.mock.calls.length;

    // Enter edit mode, replace the value, commit with Enter.
    await userEvent.click(label);
    const editor = await screen.findByRole('textbox');
    await userEvent.clear(editor);
    await userEvent.type(editor, 'renamed');
    await userEvent.keyboard('{Enter}');

    // The edit was persisted.
    await waitFor(() => expect(updateSpy).toHaveBeenCalled());
    const savedValue = updateSpy.mock.calls[0][1].value as string;
    expect(savedValue).not.toBe('original');

    // The edited value becomes visible without any unrelated refetch — the fix
    // invalidates ['tree-children', parentId], so the list refetches and the
    // node re-renders with the new value.
    expect(await screen.findByText(savedValue)).toBeInTheDocument();
    expect(listSpy.mock.calls.length).toBeGreaterThan(listCallsBefore);
  });
});
