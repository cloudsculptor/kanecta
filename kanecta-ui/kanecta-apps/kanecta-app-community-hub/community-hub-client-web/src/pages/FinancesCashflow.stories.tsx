import type { Meta, StoryObj } from "@storybook/react-vite";
import { http, HttpResponse } from "msw";
import { within, expect } from "storybook/test";
import { StoryWrapper } from "../stories/MockProviders";
import FinancesCashflow from "./FinancesCashflow";

const SAMPLE_REPORT = [
  { type: "income",  category: "membership", total: "120.00" },
  { type: "income",  category: "donation",   total: "50.00"  },
  { type: "expense", category: "hosting",    total: "72.00"  },
  { type: "expense", category: "domain",     total: "25.00"  },
];

const meta: Meta<typeof FinancesCashflow> = {
  title: "Pages/Finances/Cashflow",
  component: FinancesCashflow,
  decorators: [(Story) => <StoryWrapper role="team"><Story /></StoryWrapper>],
};
export default meta;
type Story = StoryObj<typeof FinancesCashflow>;

export const WithData: Story = {
  parameters: { msw: { handlers: [http.get("/api/finances/reports", () => HttpResponse.json(SAMPLE_REPORT))] } },
};

export const Deficit: Story = {
  parameters: {
    msw: {
      handlers: [http.get("/api/finances/reports", () => HttpResponse.json([
        { type: "income",  category: "membership", total: "30.00"  },
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
// Assert the mocked /api/finances/reports response renders receipts/payments
// and the client-computed totals. From SAMPLE_REPORT:
//   receipts 120 + 50 = 170.00  → "Total receipts" $170.00
//   payments 72 + 25  = 97.00   → "Total payments" ($97.00)  (parenthesised)
//   net operating     = 267.00  → "Net cash from operating activities" $267.00

/** Receipts, payments and totals render for a populated report. */
export const RendersReceiptsAndPayments: Story = {
  parameters: { msw: { handlers: [http.get("/api/finances/reports", () => HttpResponse.json(SAMPLE_REPORT))] } },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(await canvas.findByText("Membership contributions")).toBeInTheDocument();
    await expect(canvas.getByText("Hosting & infrastructure")).toBeInTheDocument();
    await expect(canvas.getByText("Total receipts")).toBeInTheDocument();
    await expect(canvas.getByText("$170.00")).toBeInTheDocument();
    await expect(canvas.getByText("Total payments")).toBeInTheDocument();
    await expect(canvas.getByText("($97.00)")).toBeInTheDocument();
    await expect(canvas.getByText("Net cash from operating activities")).toBeInTheDocument();
  },
};

/** An empty report shows the "no income / no payments recorded" rows. */
export const EmptyShowsNoRecords: Story = {
  parameters: { msw: { handlers: [http.get("/api/finances/reports", () => HttpResponse.json([]))] } },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(await canvas.findByText("No income recorded")).toBeInTheDocument();
    await expect(canvas.getByText("No payments recorded")).toBeInTheDocument();
  },
};
