import type { Meta, StoryObj } from '@storybook/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ThemeProvider, createTheme } from '@mui/material/styles';
import { userEvent, expect, fn, within, waitFor } from 'storybook/test';
import { TreeView } from '../components/TreeView';
import type { TreeViewApi, KanectaItem, AliasEntry } from '../types';

const theme = createTheme();

const meta: Meta<typeof TreeView> = {
  component: TreeView,
  title: 'Views/TreeView',
  decorators: [
    (Story) => (
      <QueryClientProvider client={new QueryClient()}>
        <ThemeProvider theme={theme}>
          <div style={{ padding: 16, minHeight: 200 }}>
            <Story />
          </div>
        </ThemeProvider>
      </QueryClientProvider>
    ),
  ],
};
export default meta;

type Story = StoryObj<typeof TreeView>;

const baseItem: KanectaItem = {
  id: 'item-1',
  value: 'Original value',
  type: 'text',
  confidence: 'medium',
  sortOrder: 0,
  tags: [],
  childCount: 0,
  createdAt: new Date().toISOString(),
  modifiedAt: new Date().toISOString(),
};

const rootItem: KanectaItem = {
  id: 'root-item',
  value: 'Root',
  type: 'text',
  confidence: null,
  sortOrder: 0,
  tags: [],
  childCount: 1,
  createdAt: null,
  modifiedAt: null,
};

function makeApi(overrides: Partial<TreeViewApi['items']> = {}): TreeViewApi {
  return {
    items: {
      list: fn().mockResolvedValue([baseItem]),
      root: fn().mockResolvedValue(rootItem),
      get: fn().mockResolvedValue(baseItem),
      children: fn().mockResolvedValue([baseItem]),
      tree: fn().mockResolvedValue([]),
      create: fn().mockResolvedValue({ ...baseItem, id: 'new-item', value: '' }),
      update: fn().mockResolvedValue({ ...baseItem }),
      delete: fn().mockResolvedValue({ deleted: baseItem.id }),
      getObject: fn().mockResolvedValue(null),
      getFunctionData: fn().mockResolvedValue(null),
      saveFunctionData: fn().mockResolvedValue({ ok: true }),
      runFunctionScaffold: fn().mockResolvedValue({ success: true, output: null, logs: '' }),
      compileFunctionScaffold: fn().mockResolvedValue({ success: true, output: '' }),
      checkFunctionScaffold: fn().mockResolvedValue({ exists: false, stale: false }),
      getFunctionPackageJson: fn().mockResolvedValue(null),
      ...overrides,
    },
    aliases: {
      list: fn().mockResolvedValue([]),
      listForItem: fn().mockResolvedValue([]),
      resolve: fn().mockRejectedValue(new Error('not found')),
      set: fn().mockResolvedValue({} as AliasEntry),
      remove: fn().mockResolvedValue({ removed: '' }),
    },
    breadcrumb: {
      addClipboard: fn().mockResolvedValue({ ok: true }),
      addViewed: fn().mockResolvedValue({ ok: true }),
    },
    starred: {
      list: fn().mockResolvedValue([]),
      add: fn().mockResolvedValue({ ok: true }),
      remove: fn().mockResolvedValue({ ok: true }),
    },
    view: {
      get: fn().mockResolvedValue(null),
      save: fn().mockResolvedValue({ ok: true }),
    },
    types: {
      schema: fn().mockResolvedValue(null),
    },
    tree: {
      full: fn().mockResolvedValue([]),
    },
    config: {
      get: fn().mockResolvedValue({ vscodeAvailable: false, datastorePath: '' }),
      openPath: fn().mockResolvedValue({ ok: true }),
      openInBrowser: fn().mockResolvedValue({ ok: true }),
      openInVscode: fn().mockResolvedValue({ ok: true }),
    },
  };
}

// ─── Edit persistence / flash regression ─────────────────────────────────────
//
// Regression 1: after committing an inline edit the label reverted to the
// original text until a page refresh. Root cause: updateMutation only
// invalidated ['item', id]; tree nodes live in ['tree-children'] caches which
// were never touched. Fixed by calling setQueriesData in onSuccess.
//
// Regression 2: even after fixing persistence, there was a momentary flash
// where the old value briefly reappeared. Root cause: TanStack Query calls
// onMutate with `await` internally, so even a synchronous onMutate creates a
// microtask gap — setEditing(false) renders the old value in one paint before
// the cache update arrives. Fixed by a local pendingValue state in TreeNode:
// setEditing(false) and setPendingValue(newValue) are called synchronously so
// React 18 batches them into one render that shows the new text immediately.

const updateSpy = fn();

export const EditValuePersistsAfterCommit: Story = {
  name: 'Edit — value stays visible after committing (regression: value used to disappear)',
  render: () => {
    const api = makeApi({
      update: updateSpy.mockImplementation((_id, patch) =>
        Promise.resolve({ ...baseItem, ...(patch as object) })
      ),
    });
    return (
      <TreeView
        panelId="test"
        api={api}
        workspaceKey="test-ws"
      />
    );
  },
  play: async ({ canvasElement }) => {
    updateSpy.mockClear();
    const canvas = within(canvasElement);

    // Wait for the item to render
    await waitFor(() => expect(canvas.getByText('Original value')).toBeTruthy());

    // Click the label to enter edit mode
    await userEvent.click(canvas.getByText('Original value'));

    // Wait for the contentEditable editor to appear
    await waitFor(() => expect(canvasElement.querySelector('[contenteditable]')).not.toBeNull());

    const editor = canvasElement.querySelector('[contenteditable]') as HTMLElement;

    // Replace the text
    await userEvent.clear(editor);
    await userEvent.type(editor, 'Updated value');

    // Commit by pressing Tab (blur fires onCommit)
    await userEvent.keyboard('{Tab}');

    // The old value must be gone immediately — no flash while the API call is in flight.
    // onMutate is synchronous so the cache update batches with setEditing(false) in
    // the same React render. If this assertion flickers the fix has regressed.
    await expect(canvas.queryByText('Original value')).toBeNull();

    // After the save completes the new value must still be shown
    await waitFor(() =>
      expect(updateSpy).toHaveBeenCalledWith('item-1', { value: 'Updated value' }),
    );
    await expect(canvas.getByText('Updated value')).toBeTruthy();
  },
};
