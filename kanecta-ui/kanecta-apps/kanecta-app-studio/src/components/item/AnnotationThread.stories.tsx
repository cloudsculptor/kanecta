import type { Meta, StoryObj } from '@storybook/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ThemeProvider, createTheme } from '@mui/material/styles';
import { AnnotationComposer } from './AnnotationComposer';

const meta: Meta<typeof AnnotationComposer> = {
  component: AnnotationComposer,
  title: 'Item/AnnotationComposer',
  decorators: [
    (Story) => (
      <QueryClientProvider client={new QueryClient()}>
        <ThemeProvider theme={createTheme()}>
          <div style={{ padding: 16, maxWidth: 400 }}>
            <Story />
          </div>
        </ThemeProvider>
      </QueryClientProvider>
    ),
  ],
};
export default meta;

type Story = StoryObj<typeof AnnotationComposer>;

export const Default: Story = {
  args: { onSubmit: (v) => alert(`Submit: ${v}`) },
};

export const Replying: Story = {
  args: {
    replyingTo: 'ann-123',
    onSubmit: (v) => alert(`Reply: ${v}`),
    onCancelReply: () => alert('cancel'),
  },
};
