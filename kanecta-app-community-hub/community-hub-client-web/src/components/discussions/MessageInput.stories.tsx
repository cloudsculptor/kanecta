import type { Meta, StoryObj } from "@storybook/react-vite";
import MessageInput from "./MessageInput";

const meta: Meta<typeof MessageInput> = {
  title: "Discussions/MessageInput",
  component: MessageInput,
  decorators: [(Story) => <div style={{ padding: 20, maxWidth: 600 }}><Story /></div>],
  args: {
    placeholder: "Message #general",
    onSend: async (content) => { console.log("sent:", content); },
  },
};
export default meta;
type Story = StoryObj<typeof MessageInput>;

export const Default: Story = {};

export const Disabled: Story = {
  args: { disabled: true },
};
