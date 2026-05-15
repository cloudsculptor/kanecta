import { useState } from 'react';
import type { Meta, StoryObj } from '@storybook/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ThemeProvider, createTheme } from '@mui/material/styles';
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
