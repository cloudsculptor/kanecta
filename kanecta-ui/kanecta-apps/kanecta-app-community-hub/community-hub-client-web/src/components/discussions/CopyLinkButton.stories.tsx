import type { Meta, StoryObj } from "@storybook/react-vite";
import { within, userEvent, expect, waitFor } from "storybook/test";
import CopyLinkButton from "./CopyLinkButton";

const meta: Meta<typeof CopyLinkButton> = {
  title: "Discussions/CopyLinkButton",
  component: CopyLinkButton,
  decorators: [(Story) => (
    <div style={{ display: "flex", alignItems: "center", gap: 8, padding: 40 }}>
      <span style={{ fontSize: 14, opacity: 0.6 }}>Thread header context →</span>
      <Story />
    </div>
  )],
};
export default meta;
type Story = StoryObj<typeof CopyLinkButton>;

/** Default — shows link icon at low opacity, full opacity on hover. */
export const Default: Story = {};

// ── Behaviour tests (play functions) ─────────────────────────────────────────
// CopyLinkButton has no callback props: on click it writes the current URL to
// the clipboard and flips to a transient "Copied!" tooltip. We assert the
// user-visible UI contract (the tooltip label) rather than the clipboard side
// effect, which is not reliably observable across browsers/permissions.
//
// The MUI Tooltip renders its label into a portal appended to document.body,
// so those assertions query `within(document.body)`, not the story canvas.

/** The button renders with an accessible label for the copy action. */
export const RendersCopyButton: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(
      canvas.getByRole("button", { name: "Copy link to thread" }),
    ).toBeInTheDocument();
  },
};

/** Clicking the button flips the tooltip to the "Copied!" confirmation. */
export const ClickShowsCopiedTooltip: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const body = within(document.body);
    await userEvent.click(canvas.getByRole("button", { name: "Copy link to thread" }));
    // Tooltip is force-opened while `copied` is true (title becomes "Copied!").
    await expect(await body.findByText("Copied!")).toBeInTheDocument();
  },
};

/** The "Copied!" confirmation is transient and clears itself after ~1.5s. */
export const CopiedTooltipClears: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const body = within(document.body);
    await userEvent.click(canvas.getByRole("button", { name: "Copy link to thread" }));
    await expect(await body.findByText("Copied!")).toBeInTheDocument();
    await waitFor(
      () => expect(body.queryByText("Copied!")).not.toBeInTheDocument(),
      { timeout: 2500 },
    );
  },
};
