import type { Meta, StoryObj } from "@storybook/react-vite";
import { http, HttpResponse } from "msw";
import { within, expect } from "storybook/test";
import { StoryWrapper } from "../stories/MockProviders";
import PagesList from "./PagesList";
import type { PageSummary } from "../api/pages";

// PagesList reads the REAL useKeycloak(), which stays
// { initialized: false } in Storybook. Its effect early-returns on
// `!initialized`, so it never calls listPages() and never fires the non-team
// redirect. The static header (title, Discussions / + New page links, the
// team-member Alert) plus the "Loading…" placeholder are what actually render.
// The handler below documents GET /api/pages but is not reached in stories.
const PAGES: PageSummary[] = [
  {
    id: "p1",
    slug: "emergency-plan",
    title: "Featherston Emergency Plan",
    created_by_name: "Jane Smith",
    created_at: "2026-01-10T09:00:00Z",
    updated_at: "2026-05-01T09:00:00Z",
    public: true,
    licence_id: "cc-by-4",
    version: 3,
    owner_type: "group",
    owner_id: "g1",
  },
  {
    id: "p2",
    slug: "internal-roster",
    title: "Internal Roster",
    created_by_name: "Tom Brown",
    created_at: "2026-02-02T09:00:00Z",
    updated_at: "2026-04-15T09:00:00Z",
    public: false,
    licence_id: null,
    version: 1,
    owner_type: "group",
    owner_id: "g1",
  },
];

const meta: Meta<typeof PagesList> = {
  title: "Pages/PagesList",
  component: PagesList,
  decorators: [(Story) => <StoryWrapper role="team"><Story /></StoryWrapper>],
  parameters: {
    msw: { handlers: [http.get("/api/pages", () => HttpResponse.json(PAGES))] },
  },
};
export default meta;

type Story = StoryObj<typeof PagesList>;

/**
 * Default render. Keycloak never initialises in stories, so the list fetch is
 * gated off and the page holds on its "Loading…" state under the team header.
 */
export const Default: Story = {};

/** Mobile viewport. */
export const Mobile: Story = {
  parameters: { viewport: { defaultViewport: "mobile2" } },
};

// ── Behaviour tests (play functions) ─────────────────────────────────────────

/**
 * The team header (new-page action + the "logged-in team member" notice) always
 * renders, and with Keycloak uninitialised the list stays on "Loading…".
 */
export const ShowsTeamHeaderAndLoading: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(await canvas.findByText("+ New page")).toBeInTheDocument();
    await expect(canvas.getByText(/logged-in team member/)).toBeInTheDocument();
    await expect(canvas.getByText("Loading…")).toBeInTheDocument();
  },
};
