import type { Meta, StoryObj } from "@storybook/react-vite";
import { within, expect } from "storybook/test";
import CC0Notice from "./CC0Notice";

// Self-contained presentational notice — no providers needed. The CC icons load
// from an external host and may not resolve in Storybook; that does not affect
// the assertions, which target the licence link.
const meta: Meta<typeof CC0Notice> = {
  title: "Components/CC0Notice",
  component: CC0Notice,
  decorators: [(Story) => <div style={{ padding: 20 }}><Story /></div>],
};
export default meta;
type Story = StoryObj<typeof CC0Notice>;

/** The CC0 licence notice. */
export const Default: Story = {};

/** The licence link points at the CC0 deed. */
export const LinksToLicence: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const link = canvas.getByRole("link", { name: /Creative Commons CC0 1\.0 licence/ });
    await expect(link).toHaveAttribute("href", "https://creativecommons.org/publicdomain/zero/1.0/");
  },
};
