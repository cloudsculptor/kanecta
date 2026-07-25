import type { Meta, StoryObj } from "@storybook/react-vite";
import { http, HttpResponse } from "msw";
import { within, expect } from "storybook/test";
import { StoryWrapper } from "../stories/MockProviders";
import { policiesTree } from "../stories/siteNodeFixtures";
import PoliciesIndex from "./PoliciesIndex";

// PoliciesIndex fetches the site-node tree AND the public pages list (for
// per-category page counts) unconditionally on mount — both handlers below are
// hit. Moderator controls stay hidden (Keycloak uninitialised in stories).
const meta: Meta<typeof PoliciesIndex> = {
  title: "Pages/Governance/PoliciesIndex",
  component: PoliciesIndex,
  decorators: [(Story) => <StoryWrapper role="public"><Story /></StoryWrapper>],
  parameters: {
    msw: {
      handlers: [
        http.get("/api/site-nodes/tree", () => HttpResponse.json(policiesTree())),
        http.get("/api/pages/public", () => HttpResponse.json([])),
      ],
    },
  },
};
export default meta;

type Story = StoryObj<typeof PoliciesIndex>;

/** Two policy groups; Custodian Board carries bylaws + guidelines categories. */
export const Default: Story = {};

/** Mobile viewport. */
export const Mobile: Story = {
  parameters: { viewport: { defaultViewport: "mobile2" } },
};

// ── Behaviour tests (play functions) ─────────────────────────────────────────

/** Groups render; categories link into /governance/policies/<slug>. */
export const ShowsPolicyCategories: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(await canvas.findByText("Custodian Board Bylaws")).toBeInTheDocument();
    await expect(canvas.getByText("Volunteer Bylaws")).toBeInTheDocument();
    const link = canvas.getByRole("link", { name: /Custodian Board Bylaws/ });
    expect(link).toHaveAttribute("href", "/governance/policies/custodian-bylaws");
  },
};
