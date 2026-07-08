import type { Meta, StoryObj } from "@storybook/react-vite";
import { http, HttpResponse } from "msw";
import { within, expect } from "storybook/test";
import { StoryWrapper } from "../stories/MockProviders";
import FinancesProfitLoss from "./FinancesProfitLoss";

const SAMPLE_REPORT = [
  { type: "income",  category: "membership",   total: "120.00" },
  { type: "income",  category: "donation",      total: "50.00"  },
  { type: "income",  category: "interest",      total: "3.50"   },
  { type: "expense", category: "hosting",       total: "72.00"  },
  { type: "expense", category: "domain",        total: "25.00"  },
  { type: "expense", category: "bank_charges",  total: "4.80"   },
];

const meta: Meta<typeof FinancesProfitLoss> = {
  title: "Pages/Finances/ProfitLoss",
  component: FinancesProfitLoss,
  decorators: [(Story) => <StoryWrapper role="team"><Story /></StoryWrapper>],
};
export default meta;
type Story = StoryObj<typeof FinancesProfitLoss>;

export const Surplus: Story = {
  parameters: { msw: { handlers: [http.get("/api/finances/reports", () => HttpResponse.json(SAMPLE_REPORT))] } },
};

export const Deficit: Story = {
  parameters: {
    msw: {
      handlers: [http.get("/api/finances/reports", () => HttpResponse.json([
        { type: "income",  category: "membership", total: "20.00"  },
        { type: "expense", category: "hosting",    total: "72.00"  },
        { type: "expense", category: "domain",     total: "25.00"  },
      ]))],
    },
  },
};

export const Empty: Story = {
  parameters: { msw: { handlers: [http.get("/api/finances/reports", () => HttpResponse.json([]))] } },
};

export const Mobile: Story = {
  parameters: {
    viewport: { defaultViewport: "mobile2" },
    msw: { handlers: [http.get("/api/finances/reports", () => HttpResponse.json(SAMPLE_REPORT))] },
  },
};

// ── Behaviour tests (play functions) ─────────────────────────────────────────
// Assert the mocked /api/finances/reports response renders category rows and
// the client-computed totals. Totals are derived from SAMPLE_REPORT:
//   income  120 + 50 + 3.50   = 173.50  → "Total income" $173.50
//   expense 72 + 25 + 4.80    = 101.80  → "Total expenditure" $101.80
//   net (income + expense)    = 275.30  → "Net surplus" $275.30

/** Category rows and the computed totals render for a populated report. */
export const SurplusRendersTotals: Story = {
  parameters: { msw: { handlers: [http.get("/api/finances/reports", () => HttpResponse.json(SAMPLE_REPORT))] } },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(await canvas.findByText("Membership contributions")).toBeInTheDocument();
    await expect(canvas.getByText("$120.00")).toBeInTheDocument();
    await expect(canvas.getByText("Hosting & infrastructure")).toBeInTheDocument();
    await expect(canvas.getByText("Total income")).toBeInTheDocument();
    await expect(canvas.getByText("$173.50")).toBeInTheDocument();
    await expect(canvas.getByText("Net surplus")).toBeInTheDocument();
    await expect(canvas.getByText("$275.30")).toBeInTheDocument();
  },
};

/** An empty report shows the "no income / no expenditure recorded" rows. */
export const EmptyShowsNoRecords: Story = {
  parameters: { msw: { handlers: [http.get("/api/finances/reports", () => HttpResponse.json([]))] } },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(await canvas.findByText("No income recorded")).toBeInTheDocument();
    await expect(canvas.getByText("No expenditure recorded")).toBeInTheDocument();
  },
};
