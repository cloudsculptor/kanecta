import type { Meta, StoryObj } from "@storybook/react-vite";
import { http, HttpResponse } from "msw";
import { within, expect } from "storybook/test";
import { StoryWrapper } from "../stories/MockProviders";
import { roadmapTree } from "../stories/siteNodeFixtures";
import RoadmapIndex from "./RoadmapIndex";

// RoadmapIndex fetches its site-node tree unconditionally (public read), so the
// MSW handler is hit and the stories render real content. Moderator controls
// stay hidden (Keycloak uninitialised) — covered by the component stories.
const meta: Meta<typeof RoadmapIndex> = {
  title: "Pages/Governance/RoadmapIndex",
  component: RoadmapIndex,
  decorators: [(Story) => <StoryWrapper role="public"><Story /></StoryWrapper>],
  parameters: {
    msw: {
      handlers: [
        http.get("/api/site-nodes/tree", () => HttpResponse.json(roadmapTree())),
      ],
    },
  },
};
export default meta;

type Story = StoryObj<typeof RoadmapIndex>;

/** Now/Next groups with one roadmap item each. */
export const Default: Story = {};

/** Mobile viewport. */
export const Mobile: Story = {
  parameters: { viewport: { defaultViewport: "mobile2" } },
};

// ── Behaviour tests (play functions) ─────────────────────────────────────────

/** Roadmap groups render and items link under /governance/roadmap. */
export const ShowsRoadmapGroups: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(await canvas.findByText("Now")).toBeInTheDocument();
    await expect(canvas.getByText("Next")).toBeInTheDocument();
    const link = await canvas.findByRole("link", { name: /Kanecta backend cutover/ });
    expect(link).toHaveAttribute("href", "/governance/roadmap/kanecta-cutover");
  },
};
