import type { Meta, StoryObj } from "@storybook/react-vite";
import { http, HttpResponse } from "msw";
import { within, expect } from "storybook/test";
import { StoryWrapper } from "../stories/MockProviders";
import { minutesTree } from "../stories/siteNodeFixtures";
import MinutesIndex from "./MinutesIndex";

// MinutesIndex fetches the site-node tree UNCONDITIONALLY on mount (public
// read, not Keycloak-gated), so the MSW handler below is actually hit and the
// stories render real content. Keycloak stays uninitialised in Storybook, so
// the moderator controls (SiteNodeMenu / add-group editor) never render here —
// those are covered by their own component stories.
const meta: Meta<typeof MinutesIndex> = {
  title: "Pages/Governance/MinutesIndex",
  component: MinutesIndex,
  decorators: [(Story) => <StoryWrapper role="public"><Story /></StoryWrapper>],
  parameters: {
    msw: {
      handlers: [
        http.get("/api/site-nodes/tree", () => HttpResponse.json(minutesTree())),
      ],
    },
  },
};
export default meta;

type Story = StoryObj<typeof MinutesIndex>;

/** Two minute groups (Custodian Board, Volunteers), each with a year category. */
export const Default: Story = {};

/** Mobile viewport. */
export const Mobile: Story = {
  parameters: { viewport: { defaultViewport: "mobile2" } },
};

/** Error state: the tree endpoint fails and the error line renders. */
export const TreeError: Story = {
  parameters: {
    msw: {
      handlers: [
        http.get("/api/site-nodes/tree", () =>
          HttpResponse.json({ error: "site tree unavailable" }, { status: 500 })),
      ],
    },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(await canvas.findByText("site tree unavailable")).toBeInTheDocument();
  },
};

// ── Behaviour tests (play functions) ─────────────────────────────────────────

/** Groups render as headings; categories link into the section list route. */
export const ShowsGroupsAndCategoryLinks: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(await canvas.findByText("Custodian Board")).toBeInTheDocument();
    await expect(canvas.getByText("Volunteers")).toBeInTheDocument();
    const links = await canvas.findAllByRole("link", { name: /2026/ });
    expect(links[0]).toHaveAttribute("href", "/governance/minutes/custodian-board-2026");
    await expect(canvas.getByText("Custodian Board meeting minutes from 2026.")).toBeInTheDocument();
  },
};
