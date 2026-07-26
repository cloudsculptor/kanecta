import type { Meta, StoryObj } from "@storybook/react-vite";
import { within, expect } from "storybook/test";
import { ComingCard } from "./NavCard";
import { StoryWrapper } from "../stories/MockProviders";

// ComingCard is a non-interactive "coming soon" tile (no link). It shares
// NavCard's markup, so it renders the same photo-attribution hover tooltip.
const meta: Meta<typeof ComingCard> = {
  title: "Components/ComingCard",
  component: ComingCard,
  decorators: [
    (Story) => (
      <StoryWrapper role="public">
        <div style={{ maxWidth: 320, padding: 20 }}><Story /></div>
      </StoryWrapper>
    ),
  ],
  args: {
    title: "Buy, Sell & Swap",
    blurb: "Buy, sell, swap, or give away items locally.",
  },
};
export default meta;
type Story = StoryObj<typeof ComingCard>;

const SAMPLE_IMAGE =
  "data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSIzMjAiIGhlaWdodD0iMjAwIj48cmVjdCB3aWR0aD0iMzIwIiBoZWlnaHQ9IjIwMCIgZmlsbD0iIzNhN2Q0NCIvPjwvc3ZnPg==";

/** Bare "coming soon" tile with no image (blank grayscale image area). */
export const Default: Story = {};

/** With a background photo (grayscale/faded "not live yet" treatment applies). */
export const WithImage: Story = {
  args: { image: SAMPLE_IMAGE },
};

/** With a background photo and a photo-attribution hover tooltip. */
export const WithImageAndAttribution: Story = {
  args: {
    image: SAMPLE_IMAGE,
    attribution: { label: "Photo by A. Local", url: "https://example.com" },
  },
};

/** Title and blurb render. */
export const RendersTitleAndBlurb: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByRole("heading", { name: "Buy, Sell & Swap", level: 2 })).toBeInTheDocument();
    await expect(canvas.getByText("Buy, sell, swap, or give away items locally.")).toBeInTheDocument();
  },
};

/** ComingCard is not a link — it never renders an anchor to a route. */
export const IsNotALink: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.queryByRole("link")).not.toBeInTheDocument();
  },
};
