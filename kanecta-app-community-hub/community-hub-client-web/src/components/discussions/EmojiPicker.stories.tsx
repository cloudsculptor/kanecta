import type { Meta, StoryObj } from "@storybook/react-vite";
import EmojiPicker from "./EmojiPicker";

const meta: Meta<typeof EmojiPicker> = {
  title: "Discussions/EmojiPicker",
  component: EmojiPicker,
  decorators: [(Story) => (
    <div style={{ padding: 80, position: "relative", display: "inline-block" }}>
      <Story />
    </div>
  )],
  args: {
    onSelect: (emoji) => { console.log("selected:", emoji); },
    onClose: () => {},
  },
};
export default meta;
type Story = StoryObj<typeof EmojiPicker>;

export const Open: Story = {};
