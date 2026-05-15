import type { Meta, StoryObj } from '@storybook/react';
import { SlashMenu, SLASH_ITEMS } from './SlashMenu';

const meta: Meta<typeof SlashMenu> = {
  component: SlashMenu,
  title: 'Editor/SlashMenu',
  decorators: [
    (Story) => (
      <div style={{ padding: 16, background: '#f5f5f5', minHeight: 200 }}>
        <Story />
      </div>
    ),
  ],
};
export default meta;

type Story = StoryObj<typeof SlashMenu>;

export const AllItems: Story = {
  args: {
    items: SLASH_ITEMS,
    command: (item) => alert(`Selected: ${item.type}`),
  },
};

export const Filtered: Story = {
  args: {
    items: SLASH_ITEMS.filter((i) => ['fact', 'claim', 'question'].includes(i.type)),
    command: (item) => alert(`Selected: ${item.type}`),
  },
};

export const Empty: Story = {
  args: {
    items: [],
    command: () => {},
  },
};
