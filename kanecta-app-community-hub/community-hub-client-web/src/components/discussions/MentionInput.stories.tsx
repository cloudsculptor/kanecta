import type { Meta, StoryObj } from "@storybook/react-vite";
import MentionInput from "./MentionInput";

const users = [
  { id: "u1", name: "Alice Brennan" },
  { id: "u2", name: "Ben Tukaki" },
  { id: "u3", name: "Caro Ngata" },
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

/** Default empty state — send button is disabled until you type something. */
export const Default: Story = {};

/** Disabled — both the textarea and send button are greyed out. */
export const Disabled: Story = { args: { disabled: true } };

/** No users configured — @ will produce no autocomplete dropdown. */
export const NoUsers: Story = { args: { users: [] } };

/** Large user list — verifies search filtering works across many names. */
export const ManyUsers: Story = {
  args: {
    users: [
      { id: "u1", name: "Alice Brennan" },
      { id: "u2", name: "Ben Tukaki" },
      { id: "u3", name: "Caro Ngata" },
      { id: "u4", name: "David Hou" },
      { id: "u5", name: "Eva Ramirez" },
      { id: "u6", name: "Finn Okafor" },
      { id: "u7", name: "Grace Yip" },
      { id: "u8", name: "Hemi Parata" },
    ],
  },
};
