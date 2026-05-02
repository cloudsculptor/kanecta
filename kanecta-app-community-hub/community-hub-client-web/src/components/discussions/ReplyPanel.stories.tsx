import type { Meta, StoryObj } from "@storybook/react-vite";

import ReplyPanel from "./ReplyPanel";

const parentMessage = {
  id: "m1", thread_id: "t1", parent_message_id: null,
  user_id: "user-1", user_name: "Jane Smith",
  content: "What's the plan for the weekend market?",
  created_at: new Date().toISOString(), edited_at: null, deleted_at: null, reply_count: 2,
};

const meta: Meta<typeof ReplyPanel> = {
  title: "Discussions/ReplyPanel",
  component: ReplyPanel,
  decorators: [(Story) => (
    <div style={{ display: "flex", height: "600px", border: "1px solid #eee" }}>
      <div style={{ flex: 1, background: "#f9f9f9" }} />
      <Story />
    </div>
  )],
  args: {
    parentMessage,
    currentUserId: "user-1",
    canModerate: false,
    onClose: () => {},
    onEdit: async () => {},
    onDelete: async () => {},
    onReact: async () => {},
    onUnreact: async () => {},
  },
};
export default meta;
type Story = StoryObj<typeof ReplyPanel>;

export const Default: Story = {};

export const ModeratorView: Story = {
  args: { currentUserId: "user-2", canModerate: true },
};
