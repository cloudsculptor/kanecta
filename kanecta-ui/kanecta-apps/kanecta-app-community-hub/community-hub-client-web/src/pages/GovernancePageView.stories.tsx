import type { Meta, StoryObj } from "@storybook/react-vite";
import { MemoryRouter, Routes, Route } from "react-router-dom";
import { http, HttpResponse } from "msw";
import { within, expect } from "storybook/test";
import GovernancePageView from "./GovernancePageView";

// GovernancePageView's page fetch is gated on Keycloak `initialized` (false in
// Storybook), so stories render the routed shell: slug-derived title and the
// three-level Governance → Policies → Category breadcrumb. The handler
// documents the endpoint but is not reached.
const meta: Meta<typeof GovernancePageView> = {
  title: "Pages/Governance/GovernancePageView",
  component: GovernancePageView,
  parameters: {
    msw: {
      handlers: [
        http.get("/api/pages/public/:slug", () =>
          HttpResponse.json({ error: "not reached in stories" }, { status: 404 })),
      ],
    },
  },
};
export default meta;

type Story = StoryObj<typeof GovernancePageView>;

function atRoute(path: string) {
  return (
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route
          path="/governance/policies/:category/:slug"
          element={<GovernancePageView type="policy" />}
        />
      </Routes>
    </MemoryRouter>
  );
}

/** A policy page shell: slug-cased title under the full breadcrumb trail. */
export const Default: Story = {
  render: () => atRoute("/governance/policies/custodian-bylaws/meeting-quorum"),
};

// ── Behaviour tests (play functions) ─────────────────────────────────────────

/** Both the :category and :slug params surface as Title Cased text. */
export const TitleCasesParams: Story = {
  render: () => atRoute("/governance/policies/custodian-bylaws/meeting-quorum"),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const titles = await canvas.findAllByText("Meeting Quorum");
    expect(titles.length).toBeGreaterThan(0);
    await expect(canvas.getByText("Custodian Bylaws")).toBeInTheDocument();
    await expect(canvas.getByText("Governance")).toBeInTheDocument();
  },
};
