import type { Meta, StoryObj } from "@storybook/react-vite";
import { http, HttpResponse } from "msw";
import { within, expect } from "storybook/test";
import { StoryWrapper } from "../stories/MockProviders";
import { proceduresTree } from "../stories/siteNodeFixtures";
import ProceduresIndex from "./ProceduresIndex";

// Same shape as PoliciesIndex: tree + public pages list fetched unconditionally
// on mount, so both handlers are hit and the stories render real content.
const meta: Meta<typeof ProceduresIndex> = {
  title: "Pages/Governance/ProceduresIndex",
  component: ProceduresIndex,
  decorators: [(Story) => <StoryWrapper role="public"><Story /></StoryWrapper>],
  parameters: {
    msw: {
      handlers: [
        http.get("/api/site-nodes/tree", () => HttpResponse.json(proceduresTree())),
        http.get("/api/pages/public", () => HttpResponse.json([])),
      ],
    },
  },
};
export default meta;

type Story = StoryObj<typeof ProceduresIndex>;

/** Procedure groups and categories from the seeded tree. */
export const Default: Story = {};

/** Mobile viewport. */
export const Mobile: Story = {
  parameters: { viewport: { defaultViewport: "mobile2" } },
};

// ── Behaviour tests (play functions) ─────────────────────────────────────────

/** Categories link under /governance/procedures. */
export const ShowsProcedureCategories: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const link = await canvas.findByRole("link", { name: /Custodian Board Bylaws/ });
    expect(link).toHaveAttribute("href", "/governance/procedures/custodian-bylaws");
  },
};
