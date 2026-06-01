import { useState } from 'react';
import type { Meta, StoryObj } from '@storybook/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ThemeProvider, createTheme } from '@mui/material/styles';
import { userEvent, expect, fn, within, waitFor } from 'storybook/test';
import { TreeNode } from './TreeNode';
import type { KanectaItem } from '../../../types/kanecta';

const qc = new QueryClient();
const theme = createTheme();

const meta: Meta<typeof TreeNode> = {
  component: TreeNode,
  title: 'Views/TreeNode',
  decorators: [
    (Story) => (
      <QueryClientProvider client={qc}>
        <ThemeProvider theme={theme}>
          <div style={{ padding: 16 }}>
            <Story />
          </div>
        </ThemeProvider>
      </QueryClientProvider>
    ),
  ],
};
export default meta;

type Story = StoryObj<typeof TreeNode>;

const baseItem: KanectaItem = {
  id: '1',
  value: 'Consciousness may be a fundamental feature of the universe',
  type: 'claim',
  confidence: 'medium',
  sortOrder: 0,
  tags: ['philosophy', 'consciousness'],
  childCount: 3,
  createdAt: new Date().toISOString(),
  modifiedAt: new Date().toISOString(),
};

function TreeNodeDemo({ item, confidence }: { item: KanectaItem; confidence?: KanectaItem['confidence'] }) {
  const [expanded, setExpanded] = useState(false);
  const [focused, setFocused] = useState(false);
  return (
    <TreeNode
      item={{ ...item, confidence: confidence ?? item.confidence }}
      isExpanded={expanded}
      hasChildren={(item.childCount ?? 0) > 0}
      isFocused={focused}
      onToggle={() => setExpanded((e) => !e)}
      onFocus={() => setFocused((f) => !f)}
      onZoom={() => alert('zoom')}
      onAddChild={() => alert('add child')}
      onAddSibling={() => alert('add sibling')}
      onDelete={() => alert('delete')}
      onEdit={async (v) => alert(`edit: ${v}`)}
      onIndent={() => alert('indent')}
      onOutdent={() => alert('outdent')}
      onNavigateToId={() => {}}
      onExpandToDepth={() => {}}
      onRecordClipboard={() => {}}
      onRecordViewed={() => {}}
      onCopyAs={() => {}}
    />
  );
}

export const Default: Story = { render: () => <TreeNodeDemo item={baseItem} /> };
export const ConfidenceLow: Story = { render: () => <TreeNodeDemo item={baseItem} confidence="low" /> };
export const ConfidenceHigh: Story = { render: () => <TreeNodeDemo item={baseItem} confidence="high" /> };
export const ConfidenceVerified: Story = { render: () => <TreeNodeDemo item={baseItem} confidence="verified" /> };
export const ConfidenceLocked: Story = { render: () => <TreeNodeDemo item={baseItem} confidence="locked" /> };
export const Leaf: Story = {
  render: () => <TreeNodeDemo item={{ ...baseItem, childCount: 0 }} />,
};
export const LongValue: Story = {
  render: () => (
    <TreeNodeDemo
      item={{ ...baseItem, value: 'A very long item value that should truncate when it runs out of space in the tree node row area' }}
    />
  ),
};

export const AllConfidences: Story = {
  render: () => (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      {(['low', 'medium', 'high', 'verified', 'locked'] as const).map((c) => (
        <TreeNodeDemo key={c} item={{ ...baseItem, value: `${c}: ${baseItem.value}` }} confidence={c} />
      ))}
    </div>
  ),
};

// Click-to-edit stories — click the label text to activate inline editing
export const ClickToEdit: Story = {
  name: 'Click to edit (click the label)',
  render: () => {
    function EditDemo() {
      const [value, setValue] = useState(baseItem.value);
      const [focused, setFocused] = useState(false);
      const [expanded, setExpanded] = useState(false);
      return (
        <div>
          <p style={{ fontSize: 12, color: '#666', marginBottom: 8 }}>
            Click the label text to begin editing. Press Enter, Tab, or click away to commit.
          </p>
          <TreeNode
            item={{ ...baseItem, value }}
            isExpanded={expanded}
            hasChildren={true}
            isFocused={focused}
            onToggle={() => setExpanded((e) => !e)}
            onFocus={() => setFocused((f) => !f)}
            onZoom={() => {}}
            onAddChild={() => {}}
            onAddSibling={() => {}}
            onDelete={() => {}}
            onEdit={async (v) => setValue(v)}
            onIndent={() => {}}
            onOutdent={() => {}}
            onNavigateToId={() => {}}
            onExpandToDepth={() => {}}
            onRecordClipboard={() => {}}
            onRecordViewed={() => {}}
            onCopyAs={() => {}}
          />
          <p style={{ fontSize: 11, color: '#999', marginTop: 8 }}>Current value: <strong>{value}</strong></p>
        </div>
      );
    }
    return <EditDemo />;
  },
};

export const EditShortItems: Story = {
  name: 'Click to edit — short labels',
  render: () => {
    const items = ['Buy milk', 'Read paper', 'Ship it'];
    function MultiDemo() {
      const [values, setValues] = useState(items);
      return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          {values.map((v, i) => (
            <TreeNode
              key={i}
              item={{ ...baseItem, id: String(i), value: v, childCount: 0 }}
              isExpanded={false}
              hasChildren={false}
              isFocused={false}
              onToggle={() => {}}
              onFocus={() => {}}
              onZoom={() => {}}
              onAddChild={() => {}}
              onAddSibling={() => {}}
              onDelete={() => {}}
              onEdit={async (next) => setValues((vs) => vs.map((x, j) => (j === i ? next : x)))}
              onIndent={() => {}}
              onOutdent={() => {}}
              onNavigateToId={() => {}}
              onExpandToDepth={() => {}}
              onRecordClipboard={() => {}}
              onRecordViewed={() => {}}
              onCopyAs={() => {}}
            />
          ))}
        </div>
      );
    }
    return <MultiDemo />;
  },
};

// ─── Tab-to-indent stories ───────────────────────────────────────────────────

const noopProps = {
  isExpanded: false,
  hasChildren: false,
  onToggle: () => {},
  onZoom: () => {},
  onAddChild: () => {},
  onAddSibling: () => {},
  onDelete: () => {},
  onOutdent: () => {},
  onNavigateToId: () => {},
  onExpandToDepth: () => {},
  onRecordClipboard: () => {},
  onRecordViewed: () => {},
  onCopyAs: () => {},
};

// Spies defined at module level so play functions can reference them
const indentSpy = fn();
const editSpy = fn().mockResolvedValue(undefined);
const indentAfterEditSpy = fn();

export const TabCallsIndentOnSecondSibling: Story = {
  name: 'Tab — calls onIndent when editing the second of two siblings',
  render: () => {
    function Demo() {
      const [focused, setFocused] = useState<string | null>(null);
      return (
        <div>
          <p style={{ fontSize: 12, color: '#666', marginBottom: 8 }}>
            <strong>Steps:</strong> Click "Second item" to enter edit mode, then press Tab.<br />
            <strong>Expected:</strong> onIndent is called once; no tab character is inserted.
          </p>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
            <TreeNode
              {...noopProps}
              item={{ ...baseItem, id: '1', value: 'First item', childCount: 0 }}
              isFocused={focused === '1'}
              onFocus={() => setFocused('1')}
              onEdit={async () => {}}
              onIndent={fn()}
            />
            <TreeNode
              {...noopProps}
              item={{ ...baseItem, id: '2', value: 'Second item', childCount: 0 }}
              isFocused={focused === '2'}
              onFocus={() => setFocused('2')}
              onEdit={async () => {}}
              onIndent={indentSpy}
            />
          </div>
        </div>
      );
    }
    return <Demo />;
  },
  play: async ({ canvasElement }) => {
    indentSpy.mockClear();
    const canvas = within(canvasElement);

    // Click "Second item" — enters edit mode
    await userEvent.click(canvas.getByText('Second item'));

    // Wait for the contentEditable editor to appear
    await waitFor(() => expect(canvasElement.querySelector('[contenteditable]')).not.toBeNull());

    // Press Tab — should call onIndent, not insert a tab
    await userEvent.keyboard('{Tab}');

    await waitFor(() => expect(indentSpy).toHaveBeenCalledOnce());

    // Confirm no tab character was inserted into the editor
    const editor = canvasElement.querySelector('[contenteditable]');
    await expect(editor?.textContent ?? '').not.toContain('\t');
  },
};

export const TabOnFirstItemStillCallsIndent: Story = {
  name: 'Tab — calls onIndent even when item is first; handler decides whether to move',
  render: () => {
    function Demo() {
      const [focused, setFocused] = useState(false);
      return (
        <div>
          <p style={{ fontSize: 12, color: '#666', marginBottom: 8 }}>
            <strong>Steps:</strong> Click "Only item" to enter edit mode, then press Tab.<br />
            <strong>Expected:</strong> onIndent is called. The handler (not TreeNode) is responsible
            for doing nothing when there is no previous sibling.
          </p>
          <TreeNode
            {...noopProps}
            item={{ ...baseItem, id: '1', value: 'Only item', childCount: 0 }}
            isFocused={focused}
            onFocus={() => setFocused(true)}
            onEdit={async () => {}}
            onIndent={indentSpy}
          />
        </div>
      );
    }
    return <Demo />;
  },
  play: async ({ canvasElement }) => {
    indentSpy.mockClear();

    await userEvent.click(within(canvasElement).getByText('Only item'));
    await waitFor(() => expect(canvasElement.querySelector('[contenteditable]')).not.toBeNull());

    await userEvent.keyboard('{Tab}');

    await waitFor(() => expect(indentSpy).toHaveBeenCalledOnce());
  },
};

export const TabCommitsEditThenIndents: Story = {
  name: 'Tab — commits edited text before calling onIndent',
  render: () => {
    function Demo() {
      const [focused, setFocused] = useState<string | null>(null);
      const [values, setValues] = useState(['First item', 'Second item']);
      return (
        <div>
          <p style={{ fontSize: 12, color: '#666', marginBottom: 8 }}>
            <strong>Steps:</strong> Click "Second item", clear the text, type "Updated text", press Tab.<br />
            <strong>Expected:</strong> onEdit is called with "Updated text" before onIndent fires.
          </p>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
            <TreeNode
              {...noopProps}
              item={{ ...baseItem, id: '1', value: values[0], childCount: 0 }}
              isFocused={focused === '1'}
              onFocus={() => setFocused('1')}
              onEdit={async (v) => setValues((prev) => [v, prev[1]])}
              onIndent={fn()}
            />
            <TreeNode
              {...noopProps}
              item={{ ...baseItem, id: '2', value: values[1], childCount: 0 }}
              isFocused={focused === '2'}
              onFocus={() => setFocused('2')}
              onEdit={editSpy}
              onIndent={indentAfterEditSpy}
            />
          </div>
          <p style={{ fontSize: 11, color: '#999', marginTop: 8 }}>
            onEdit called: <strong>{String(editSpy.mock.calls.length > 0)}</strong> —
            onIndent called: <strong>{String(indentAfterEditSpy.mock.calls.length > 0)}</strong>
          </p>
        </div>
      );
    }
    return <Demo />;
  },
  play: async ({ canvasElement }) => {
    editSpy.mockClear();
    indentAfterEditSpy.mockClear();

    await userEvent.click(within(canvasElement).getByText('Second item'));
    await waitFor(() => expect(canvasElement.querySelector('[contenteditable]')).not.toBeNull());

    const editor = canvasElement.querySelector('[contenteditable]') as HTMLElement;

    // Clear existing text and type new value
    await userEvent.clear(editor);
    await userEvent.type(editor, 'Updated text');

    // Tab should commit the edit then call onIndent
    await userEvent.keyboard('{Tab}');

    // onEdit must be called with the new value before onIndent fires
    await waitFor(() => expect(editSpy).toHaveBeenCalledWith('Updated text'));
    await waitFor(() => expect(indentAfterEditSpy).toHaveBeenCalledOnce());
  },
};
