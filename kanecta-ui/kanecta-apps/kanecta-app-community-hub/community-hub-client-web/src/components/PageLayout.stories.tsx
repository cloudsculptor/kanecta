import type { Meta, StoryObj } from "@storybook/react-vite";
import { within, expect } from "storybook/test";
import PageLayout from "./PageLayout";
import { StoryWrapper } from "../stories/MockProviders";

// PageLayout renders Header, Breadcrumb and Footer, all of which need a router
// (useNavigate / <Link>). StoryWrapper (public role → logged out) supplies it.
const meta: Meta<typeof PageLayout> = {
  title: "Components/PageLayout",
  component: PageLayout,
  decorators: [(Story) => <StoryWrapper role="public"><Story /></StoryWrapper>],
  args: {
    pageName: "Community Groups",
    children: <p>Some page content lives here.</p>,
  },
};
export default meta;
type Story = StoryObj<typeof PageLayout>;

/** Default — coming-soon banner shown (showComingSoon defaults to true). */
export const Default: Story = {};

/** Content page with the coming-soon banner suppressed. */
export const WithoutComingSoon: Story = {
  args: { showComingSoon: false },
};

/** Nested page with parent breadcrumbs. */
export const WithParents: Story = {
  args: {
    parents: [{ name: "Governance", path: "/governance" }],
    showComingSoon: false,
  },
};

/** Work-in-progress governance page — warning banner shown. */
export const WorkInProgress: Story = {
  args: { wip: true, showComingSoon: false },
};

/** The page title heading and the passed children render. */
export const RendersTitleAndChildren: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByRole("heading", { name: "Community Groups", level: 2 })).toBeInTheDocument();
    await expect(canvas.getByText("Some page content lives here.")).toBeInTheDocument();
  },
};

/** The breadcrumb marks the current page. */
export const RendersBreadcrumbCurrent: Story = {
  play: async ({ canvasElement }) => {
    const current = canvasElement.querySelector('[aria-current="page"]');
    await expect(current).toHaveTextContent("Community Groups");
  },
};

/** Parent crumbs render as links to their paths. */
export const RendersParentCrumbLink: Story = {
  args: {
    parents: [{ name: "Governance", path: "/governance" }],
    showComingSoon: false,
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const link = canvas.getByRole("link", { name: "Governance" });
    await expect(link).toHaveAttribute("href", "/governance");
  },
};

/** The coming-soon banner is present by default and absent when suppressed. */
export const ComingSoonTogglesOff: Story = {
  args: { showComingSoon: false },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.queryByText(/coming soon/i)).not.toBeInTheDocument();
  },
};

/** The work-in-progress alert renders when wip is set. */
export const ShowsWipAlert: Story = {
  args: { wip: true, showComingSoon: false },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByText("Work in progress")).toBeInTheDocument();
  },
};
