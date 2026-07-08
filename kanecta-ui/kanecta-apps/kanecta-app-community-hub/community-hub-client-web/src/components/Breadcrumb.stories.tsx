import type { Meta, StoryObj } from "@storybook/react-vite";
import { within, expect } from "storybook/test";
import Breadcrumb from "./Breadcrumb";
import { StoryWrapper } from "../stories/MockProviders";

// Breadcrumb renders <Link>s, so it needs a router. StoryWrapper supplies one.
const meta: Meta<typeof Breadcrumb> = {
  title: "Components/Breadcrumb",
  component: Breadcrumb,
  decorators: [(Story) => <StoryWrapper role="public"><Story /></StoryWrapper>],
  args: { pageName: "Events" },
};
export default meta;
type Story = StoryObj<typeof Breadcrumb>;

/** Top-level page — home icon then current page. */
export const TopLevel: Story = {};

/** Nested page with parent crumbs. */
export const Nested: Story = {
  args: {
    pageName: "Membership",
    parents: [{ name: "Governance", path: "/governance" }],
  },
};

/** Home link points at "/" and the current page is marked. */
export const RendersHomeAndCurrent: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByRole("link", { name: "Home" })).toHaveAttribute("href", "/");
    const current = canvasElement.querySelector('[aria-current="page"]');
    await expect(current).toHaveTextContent("Events");
  },
};

/** Parent crumbs render as links to their paths. */
export const RendersParentLink: Story = {
  args: {
    pageName: "Membership",
    parents: [{ name: "Governance", path: "/governance" }],
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByRole("link", { name: "Governance" })).toHaveAttribute("href", "/governance");
    const current = canvasElement.querySelector('[aria-current="page"]');
    await expect(current).toHaveTextContent("Membership");
  },
};
