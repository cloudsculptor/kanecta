import type { Meta, StoryObj } from "@storybook/react-vite";
import { within, expect } from "storybook/test";
import { NavCard } from "./NavCard";
import { StoryWrapper } from "../stories/MockProviders";

// NavCard is a <Link> tile, so it needs a router. StoryWrapper supplies one.
const meta: Meta<typeof NavCard> = {
  title: "Components/NavCard",
  component: NavCard,
  decorators: [
    (Story) => (
      <StoryWrapper role="public">
        <div style={{ maxWidth: 320, padding: 20 }}><Story /></div>
      </StoryWrapper>
    ),
  ],
  args: {
    title: "Events",
    blurb: "Find out what's on around town.",
    path: "/events",
  },
};
export default meta;
type Story = StoryObj<typeof NavCard>;

/** Basic tile. */
export const Default: Story = {};

/** Featured variant. */
export const Featured: Story = {
  args: { featured: true },
};

/** Accent variant. */
export const Accent: Story = {
  args: { accent: true },
};

/** Tile with a background image and photo attribution tooltip. */
export const WithImageAndAttribution: Story = {
  args: {
    image:
      "data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSIzMjAiIGhlaWdodD0iMjAwIj48cmVjdCB3aWR0aD0iMzIwIiBoZWlnaHQ9IjIwMCIgZmlsbD0iIzNhN2Q0NCIvPjwvc3ZnPg==",
    attribution: { label: "Photo by A. Local", url: "https://example.com" },
  },
};

/** Title and blurb render. */
export const RendersTitleAndBlurb: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByRole("heading", { name: "Events", level: 2 })).toBeInTheDocument();
    await expect(canvas.getByText("Find out what's on around town.")).toBeInTheDocument();
  },
};

/** The tile links to its target path. */
export const LinksToPath: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const link = canvas.getByRole("link");
    await expect(link).toHaveAttribute("href", "/events");
  },
};
