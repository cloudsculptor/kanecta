import type { Meta, StoryObj } from '@storybook/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ThemeProvider, createTheme } from '@mui/material/styles';
import { BlockEditor } from './BlockEditor';

const decorator = (Story: React.ComponentType) => (
  <QueryClientProvider client={new QueryClient()}>
    <ThemeProvider theme={createTheme()}>
      <div style={{ width: 640, height: 400, border: '1px solid #ddd', borderRadius: 6 }}>
        <Story />
      </div>
    </ThemeProvider>
  </QueryClientProvider>
);

const meta: Meta<typeof BlockEditor> = {
  component: BlockEditor,
  title: 'Editor/BlockEditor',
  decorators: [decorator],
};
export default meta;

type Story = StoryObj<typeof BlockEditor>;

export const Empty: Story = {
  args: { itemId: 'item-1', initialContent: '' },
};

export const WithContent: Story = {
  args: {
    itemId: 'item-2',
    initialContent:
      '<h2>Research notes</h2><p>This is a rich text block. Type <strong>/</strong> to insert a block type or <strong>@</strong> to mention an item.</p><ul><li>First observation</li><li>Second observation</li></ul>',
  },
};

export const LongContent: Story = {
  args: {
    itemId: 'item-3',
    initialContent: Array(20)
      .fill('<p>Lorem ipsum dolor sit amet, consectetur adipiscing elit. Sed do eiusmod tempor.</p>')
      .join(''),
  },
};
