import type { Meta, StoryObj } from '@storybook/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { expect, within } from 'storybook/test';
import { TopBar } from './TopBar';

const meta: Meta<typeof TopBar> = {
  component: TopBar,
  title: 'Shell/TopBar',
  parameters: { layout: 'fullscreen' },
  decorators: [
    // TopBar embeds the working-set selector, which uses React Query — provide
    // a client so the stories render instead of throwing "No QueryClient set".
    (Story) => (
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <div style={{ background: '#535754' }}>
          <Story />
        </div>
      </QueryClientProvider>
    ),
  ],
};
export default meta;

type Story = StoryObj<typeof TopBar>;

export const Default: Story = {
  args: {
    activeView: 'tree',
    onViewSelect: () => {},
    onQuickCapture: () => {},
    onCommandPalette: () => {},
  },
};

export const HomeActive: Story = {
  args: {
    activeView: 'home',
    onViewSelect: () => {},
    onQuickCapture: () => {},
    onCommandPalette: () => {},
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const homeBtn = canvas.getByRole('button', { name: 'Home' });
    await expect(homeBtn).toHaveAttribute('aria-current', 'page');
  },
};
