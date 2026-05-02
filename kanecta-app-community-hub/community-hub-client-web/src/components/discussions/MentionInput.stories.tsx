import type { Meta, StoryObj } from "@storybook/react-vite";
import MentionInput from "./MentionInput";

const users = [
  { id: "u1", name: "Jane Smith" },
  { id: "u2", name: "Mike Robinson" },
  { id: "u3", name: "Aroha Tane" },
];

const meta: Meta<typeof MentionInput> = {
  title: "Discussions/MentionInput",
  component: MentionInput,
  decorators: [(Story) => <div style={{ padding: 20, maxWidth: 600 }}><Story /></div>],
  args: {
    placeholder: "Message #general",
    onSend: async (content) => { console.log("sent:", content); },
    users,
  },
};
export default meta;
type Story = StoryObj<typeof MentionInput>;

export const Default: Story = {};
export const Disabled: Story = { args: { disabled: true } };
export const NoUsers: Story = { args: { users: [] } };
