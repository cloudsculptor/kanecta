import type { Meta, StoryObj } from "@storybook/react-vite";
import { MemoryRouter } from "react-router-dom";
import MessageItem from "./MessageItem";

const base = {
  id: "m1", thread_id: "t1", parent_message_id: null,
  user_id: "user-1", user_name: "Jane Smith",
  content: "Hey everyone, what's the plan for the weekend market?",
  created_at: new Date().toISOString(), edited_at: null, deleted_at: null, reply_count: 0,
};

const noop = async () => {};

const meta: Meta<typeof MessageItem> = {
  title: "Discussions/MessageItem",
  component: MessageItem,
  decorators: [(Story) => <MemoryRouter><div style={{ padding: 20, maxWidth: 600 }}><Story /></div></MemoryRouter>],
  args: {
    message: base, reactions: [], currentUserId: "user-1",
    canModerate: false, onEdit: noop, onDelete: noop,
    onReact: noop, onUnreact: noop, onOpenReplies: noop,
  },
};
export default meta;
type Story = StoryObj<typeof MessageItem>;

export const Default: Story = {};

export const OtherUser: Story = {
  args: { currentUserId: "user-2" },
};

export const WithReplies: Story = {
  args: { message: { ...base, reply_count: 5 } },
};

export const Edited: Story = {
  args: { message: { ...base, edited_at: new Date().toISOString() } },
};

export const Deleted: Story = {
  args: { message: { ...base, deleted_at: new Date().toISOString(), content: "" } },
};

export const WithReactions: Story = {
  args: {
    reactions: [
      { emoji: "👍", count: "3", user_ids: ["user-1", "user-2", "user-3"] },
      { emoji: "❤️", count: "1", user_ids: ["user-2"] },
    ],
  },
};

export const ModeratorView: Story = {
  args: { currentUserId: "user-2", canModerate: true },
};
