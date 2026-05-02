import type { Meta, StoryObj } from "@storybook/react-vite";
import CreateThreadModal from "./CreateThreadModal";

const meta: Meta<typeof CreateThreadModal> = {
  title: "Discussions/CreateThreadModal",
  component: CreateThreadModal,
  args: {
    open: true,
    onClose: () => {},
    onCreate: async (name, desc) => { console.log("create:", name, desc); },
  },
};
export default meta;
type Story = StoryObj<typeof CreateThreadModal>;

export const Open: Story = {};

export const Closed: Story = {
  args: { open: false },
};
