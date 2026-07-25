import type { Meta, StoryObj } from "@storybook/react-vite";
import { http, HttpResponse } from "msw";
import { within, expect, waitFor } from "storybook/test";
import { StoryWrapper } from "../stories/MockProviders";
import PagesListPublic from "./PagesListPublic";
import type { PageSummary } from "../api/pages";

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
    archived_at: null,
  },
  {
    id: "p2",
    slug: "civil-defence-contacts",
    title: "Civil Defence Contacts",
    created_by_name: "Tom Brown",
    created_at: "2026-02-02T09:00:00Z",
    updated_at: "2026-04-15T09:00:00Z",
    public: true,
    licence_id: null,
    version: 1,
    owner_type: "group",
    owner_id: "g1",
    archived_at: null,
  },
];

const meta: Meta<typeof PagesListPublic> = {
  title: "Pages/PagesListPublic",
  component: PagesListPublic,
  decorators: [(Story) => <StoryWrapper role="public"><Story /></StoryWrapper>],
  parameters: {
    msw: { handlers: [http.get("/api/pages/public", () => HttpResponse.json(PAGES))] },
  },
};
export default meta;

type Story = StoryObj<typeof PagesListPublic>;

/** Public documents list with a couple of entries. */
export const Default: Story = {};

/** No public documents published yet. */
export const Empty: Story = {
  parameters: { msw: { handlers: [http.get("/api/pages/public", () => HttpResponse.json([]))] } },
};

/** Mobile viewport. */
export const Mobile: Story = {
  parameters: { viewport: { defaultViewport: "mobile2" } },
};

// ── Behaviour tests (play functions) ─────────────────────────────────────────
// PagesListPublic fetches GET /api/pages/public on mount with no auth guard.

/** The fetched public pages render as list links. */
export const ListRendersFromApi: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(await canvas.findByText("Featherston Emergency Plan")).toBeInTheDocument();
    await expect(canvas.getByText("Civil Defence Contacts")).toBeInTheDocument();
  },
};

/**
 * Regression guard (issue: "all pages showing under resilience"). All content —
 * governance sections, site-editable pages — lives in the shared `pages` table
 * distinguished by owner_type; GET /api/pages/public returns every public one.
 * The Resilience list must show only resilience-owned pages (owner_type
 * "group"/"private") and filter the rest out. A lost filter regressed this once.
 */
export const FiltersOutNonGroupPages: Story = {
  parameters: {
    msw: {
      handlers: [
        http.get("/api/pages/public", () =>
          HttpResponse.json([
            ...PAGES,
            { ...PAGES[0], id: "s1", slug: "home", title: "Site Home Page", owner_type: "site" },
            { ...PAGES[0], id: "g1", slug: "privacy-policy", title: "Privacy Policy", owner_type: "policy-legal" },
          ])
        ),
      ],
    },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    // Resilience-owned pages render…
    await expect(await canvas.findByText("Featherston Emergency Plan")).toBeInTheDocument();
    await expect(canvas.getByText("Civil Defence Contacts")).toBeInTheDocument();
    // …but site and governance pages are filtered out.
    await expect(canvas.queryByText("Site Home Page")).not.toBeInTheDocument();
    await expect(canvas.queryByText("Privacy Policy")).not.toBeInTheDocument();
  },
};

/** An empty response shows the "no public documents" message. */
export const EmptyShowsMessage: Story = {
  parameters: { msw: { handlers: [http.get("/api/pages/public", () => HttpResponse.json([]))] } },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(await canvas.findByText("No public documents yet.")).toBeInTheDocument();
  },
};

/**
 * A network failure surfaces the error paragraph. listPublicPages() has no
 * res.ok check, so only a rejected fetch (not an HTTP 500 with a JSON body)
 * reaches the .catch → setError path; assert the .pages-error element appears.
 */
export const LoadErrorShowsError: Story = {
  parameters: { msw: { handlers: [http.get("/api/pages/public", () => HttpResponse.error())] } },
  play: async ({ canvasElement }) => {
    await waitFor(() =>
      expect(canvasElement.querySelector(".pages-error")).toBeInTheDocument()
    );
  },
};
