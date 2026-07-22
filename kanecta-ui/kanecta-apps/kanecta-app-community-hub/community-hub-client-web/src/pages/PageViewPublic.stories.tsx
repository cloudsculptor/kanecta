import type { Meta, StoryObj } from "@storybook/react-vite";
import { MemoryRouter, Routes, Route } from "react-router-dom";
import { http, HttpResponse } from "msw";
import { within, expect } from "storybook/test";
import PageViewPublic from "./PageViewPublic";
import type { Page } from "../api/pages";

// A minimal, valid Lexical serialized editor state (root → paragraph → text).
// LexicalEditor renders this read-only; the play tests assert the plain-DOM
// title / licence / version rather than Lexical's internal markup.
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
            text: "In an emergency, gather at the Featherston community hall.",
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
  public: true,
  licence_id: "cc-by-4",
  licence_name: "CC BY 4.0",
  version: 3,
  owner_type: "group",
  owner_id: "g1",
  archived_at: null,
  group_name: "Resilience Team",
};

// The page reads `:slug` from the URL and fetches GET /api/pages/public/:slug.
// A MemoryRouter with a matching route supplies the param so the fetch URL is real.
const SLUG_ROUTE = "/resilience/pages/emergency-plan";

const meta: Meta<typeof PageViewPublic> = {
  title: "Pages/PageViewPublic",
  component: PageViewPublic,
  decorators: [
    (Story) => (
      <MemoryRouter initialEntries={[SLUG_ROUTE]}>
        <Routes>
          <Route path="/resilience/pages/:slug" element={<Story />} />
        </Routes>
      </MemoryRouter>
    ),
  ],
  parameters: {
    msw: { handlers: [http.get("/api/pages/public/:slug", () => HttpResponse.json(PAGE))] },
  },
};
export default meta;

type Story = StoryObj<typeof PageViewPublic>;

/** Public page loads and renders its title, licence and content. */
export const Default: Story = {};

/** Page not found — the API 404s and the error message renders. */
export const NotFound: Story = {
  parameters: {
    msw: {
      handlers: [
        http.get("/api/pages/public/:slug", () =>
          HttpResponse.json({ error: "Page not found" }, { status: 404 })
        ),
      ],
    },
  },
};

/** Mobile viewport. */
export const Mobile: Story = {
  parameters: { viewport: { defaultViewport: "mobile2" } },
};

// ── Behaviour tests (play functions) ─────────────────────────────────────────
// PageViewPublic has no auth guard, so it fetches on mount and MSW responds.

/** The fetched public page renders its title, licence and version once resolved. */
export const RendersPageFromApi: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    // Title appears in both the breadcrumb and the page heading — assert at least one.
    await expect((await canvas.findAllByText("Featherston Emergency Plan"))[0]).toBeInTheDocument();
    await expect(canvas.getByText("CC BY 4.0")).toBeInTheDocument();
    await expect(canvas.getByText("v3")).toBeInTheDocument();
  },
};

/** A 404 from the API surfaces the thrown error message. */
export const NotFoundShowsError: Story = {
  parameters: {
    msw: {
      handlers: [
        http.get("/api/pages/public/:slug", () =>
          HttpResponse.json({ error: "Page not found" }, { status: 404 })
        ),
      ],
    },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(await canvas.findByText("Page not found")).toBeInTheDocument();
  },
};
