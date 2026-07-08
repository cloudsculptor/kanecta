import type { Meta, StoryObj, Decorator } from "@storybook/react-vite";
import { within, userEvent, expect, waitFor, fn } from "storybook/test";
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

// ── Behaviour tests (play functions) ─────────────────────────────────────────
// EmojiPicker wraps emoji-mart's <em-emoji-picker> custom element, which renders
// its emoji grid inside a shadow root. testing-library queries do not pierce
// shadow DOM, so clicking a specific emoji to assert `onSelect` is NOT reliably
// queryable here — that path is left to the live app / emoji-mart's own tests.
// We assert what IS reliably present in the light DOM: the picker mounts, the
// attribution link renders, and outside-click dismissal fires `onClose`.

const withTrigger: Decorator = (Story) => (
  <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "100vh" }}>
    <div style={{ position: "relative" }}>
      <button style={{ padding: "6px 10px" }}>😊 trigger</button>
      <Story />
    </div>
  </div>
);

/** The emoji-mart web component mounts into the picker's light DOM container. */
export const MountsPicker: Story = {
  decorators: [withTrigger],
  args: { onSelect: fn(), onClose: fn() },
  play: async ({ canvasElement }) => {
    await waitFor(() =>
      expect(canvasElement.querySelector("em-emoji-picker")).toBeInTheDocument(),
    );
  },
};

/** The Noto Emoji attribution link is always present (licensing requirement). */
export const RendersAttribution: Story = {
  decorators: [withTrigger],
  args: { onSelect: fn(), onClose: fn() },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const link = canvas.getByRole("link", { name: /Noto Emoji/ });
    await expect(link).toBeInTheDocument();
    await expect(link).toHaveAttribute("href", expect.stringContaining("fonts.google.com"));
  },
};

/**
 * Clicking outside the picker (here, the trigger button beside it) dismisses it
 * via the document mousedown handler, calling onClose.
 */
export const OutsideClickCallsOnClose: Story = {
  decorators: [withTrigger],
  args: { onSelect: fn(), onClose: fn() },
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement);
    // Wait for the picker to mount before dismissing it.
    await waitFor(() =>
      expect(canvasElement.querySelector("em-emoji-picker")).toBeInTheDocument(),
    );
    await userEvent.click(canvas.getByRole("button", { name: /trigger/ }));
    await expect(args.onClose).toHaveBeenCalled();
  },
};
