import type { Meta, StoryObj } from "@storybook/react-vite";
import { MemoryRouter, Routes, Route } from "react-router-dom";
import { http, HttpResponse } from "msw";
import { within, expect } from "storybook/test";
import GovernanceSectionList from "./GovernanceSectionList";

// GovernanceSectionList reads the REAL useKeycloak(), which in Storybook stays
// { initialized: false } — its pages fetch is gated on `initialized`, so the
// component holds on its loading state under the section header. What the
// stories exercise is the routed shell: the :category param → title casing and
// the Governance → Policies breadcrumb trail. The handler documents the
// endpoint but is not reached.
const meta: Meta<typeof GovernanceSectionList> = {
  title: "Pages/Governance/GovernanceSectionList",
  component: GovernanceSectionList,
  parameters: {
    msw: {
      handlers: [http.get("/api/pages/public", () => HttpResponse.json([]))],
    },
  },
};
export default meta;

type Story = StoryObj<typeof GovernanceSectionList>;

function atRoute(path: string, type: "policy" | "procedure" | "minutes" | "roadmap") {
  return (
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/governance/policies/:category" element={<GovernanceSectionList type={type} />} />
        <Route path="/governance/minutes/:category" element={<GovernanceSectionList type={type} />} />
      </Routes>
    </MemoryRouter>
  );
}

/** A policy category: slug-cased title with the governance breadcrumb trail. */
export const PolicyCategory: Story = {
  render: () => atRoute("/governance/policies/custodian-bylaws", "policy"),
};

/** A minutes category renders the same shell under the Minutes prefix. */
export const MinutesCategory: Story = {
  render: () => atRoute("/governance/minutes/custodian-board-2026", "minutes"),
};

// ── Behaviour tests (play functions) ─────────────────────────────────────────

/** The :category slug becomes the Title Cased heading and breadcrumb leaf. */
export const TitleCasesCategorySlug: Story = {
  render: () => atRoute("/governance/policies/custodian-bylaws", "policy"),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const matches = await canvas.findAllByText("Custodian Bylaws");
    expect(matches.length).toBeGreaterThan(0);
    await expect(canvas.getByText("Governance")).toBeInTheDocument();
    await expect(canvas.getByText("Policies")).toBeInTheDocument();
  },
};
