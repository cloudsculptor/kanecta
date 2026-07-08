import type { Meta, StoryObj } from "@storybook/react-vite";
import { MemoryRouter, Routes, Route } from "react-router-dom";
import { http, HttpResponse } from "msw";
import { within, expect } from "storybook/test";
import PageView from "./PageView";
import type { Page } from "../api/pages";

// PageView reads the REAL useKeycloak(), which in Storybook stays
// { initialized: false, authenticated: false } (no KeycloakProvider is mounted
// in preview). Its effect early-returns on `!initialized`, so it never fetches
// GET /api/pages/:slug and never fires the `!authenticated` redirect — the page
// just renders its shell and the "Loading…" placeholder. The handler below
// documents the endpoint but is not reached in stories.
const CONTENT_JSON = {
  root: {
    children: [
      {
        children: [
          {
            detail: 0,
            format: 0,
            mode: "normal",
            style: "",
            text: "Team-only resilience notes.",
            type: "text",
            version: 1,
          },
        ],
        direction: "ltr",
        format: "",
        indent: 0,
        type: "paragraph",
        version: 1,
      },
    ],
    direction: "ltr",
    format: "",
    indent: 0,
    type: "root",
    version: 1,
  },
};

const PAGE: Page = {
  id: "p1",
  slug: "emergency-plan",
  title: "Featherston Emergency Plan",
  content_json: CONTENT_JSON,
  created_by_id: "u1",
  created_by_name: "Jane Smith",
  created_at: "2026-01-10T09:00:00Z",
  updated_at: "2026-05-01T09:00:00Z",
  public: false,
  licence_id: null,
  licence_name: null,
  version: 3,
  owner_type: "group",
  owner_id: "g1",
  group_name: "Resilience Team",
};

const meta: Meta<typeof PageView> = {
  title: "Pages/PageView",
  component: PageView,
  decorators: [
    (Story) => (
      <MemoryRouter initialEntries={["/groups/resilience/emergency-plan"]}>
        <Routes>
          <Route path="/groups/resilience/:slug" element={<Story />} />
        </Routes>
      </MemoryRouter>
    ),
  ],
  parameters: {
    msw: { handlers: [http.get("/api/pages/:slug", () => HttpResponse.json(PAGE))] },
  },
};
export default meta;

type Story = StoryObj<typeof PageView>;

/**
 * Default render. Because Keycloak never initialises in stories, the fetch is
 * gated off and the page holds on its "Loading…" state.
 */
export const Default: Story = {};

/** Mobile viewport. */
export const Mobile: Story = {
  parameters: { viewport: { defaultViewport: "mobile2" } },
};

// ── Behaviour tests (play functions) ─────────────────────────────────────────

/**
 * With Keycloak uninitialised, the effect early-returns before fetching or
 * redirecting, so the page renders its "Loading…" placeholder.
 */
export const ShowsLoadingWhileKeycloakUninitialised: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(await canvas.findByText("Loading…")).toBeInTheDocument();
    // The gated fetch never runs, so the page title never appears.
    await expect(canvas.queryByText("Featherston Emergency Plan")).not.toBeInTheDocument();
  },
};
