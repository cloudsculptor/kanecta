import type { Meta, StoryObj } from "@storybook/react-vite";
import EmojiPicker from "./EmojiPicker";

const meta: Meta<typeof EmojiPicker> = {
  title: "Discussions/EmojiPicker",
  component: EmojiPicker,
  args: {
    onSelect: (emoji) => { console.log("selected:", emoji); },
    onClose: () => {},
  },
};
export default meta;
type Story = StoryObj<typeof EmojiPicker>;

/** Default — centred in viewport, picker opens above the trigger. */
export const Open: Story = {
  decorators: [(Story) => (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "100vh" }}>
      <div style={{ position: "relative" }}>
        <button style={{ padding: "6px 10px" }}>😊 trigger</button>
        <Story />
      </div>
    </div>
  )],
};

/**
 * Trigger near top of viewport — picker should flip to open downward
 * rather than clipping above the screen.
 */
export const NearTop: Story = {
  decorators: [(Story) => (
    <div style={{ position: "relative", margin: "8px 0 0 80px" }}>
      <button style={{ padding: "6px 10px" }}>😊 trigger</button>
      <Story />
    </div>
  )],
};

/**
 * Trigger near right edge of viewport — picker should flip to align
 * its right edge with the trigger rather than running off-screen.
 */
export const NearRightEdge: Story = {
  decorators: [(Story) => (
    <div style={{ position: "absolute", right: 8, top: "50vh" }}>
      <div style={{ position: "relative" }}>
        <button style={{ padding: "6px 10px" }}>😊 trigger</button>
        <Story />
      </div>
    </div>
  )],
};

/**
 * Trigger near bottom-right corner — picker should flip both axes:
 * open upward and align to the right edge.
 */
export const NearBottomRight: Story = {
  decorators: [(Story) => (
    <div style={{ position: "fixed", bottom: 16, right: 16 }}>
      <div style={{ position: "relative" }}>
        <button style={{ padding: "6px 10px" }}>😊 trigger</button>
        <Story />
      </div>
    </div>
  )],
};
