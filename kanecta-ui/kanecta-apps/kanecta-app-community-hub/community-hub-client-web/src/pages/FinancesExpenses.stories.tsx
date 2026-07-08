import type { Meta, StoryObj } from "@storybook/react-vite";
import { http, HttpResponse } from "msw";
import { within, expect } from "storybook/test";
import { StoryWrapper } from "../stories/MockProviders";
import FinancesExpenses from "./FinancesExpenses";
import type { Expense } from "../api/finances";

// FinancesExpenses fetches GET /api/finances/expenses (getExpenses) directly in a
// useEffect with no role gate, so it renders its tables regardless of the mocked
// auth role — the fetched rows and the client-computed totals both render.
//
// The component splits rows by `frequency` and sums `nzd_amount`:
//   monthlyNZD    = Σ nzd_amount where frequency === "monthly"
//   annualNZD     = Σ nzd_amount where frequency === "annual"
//   totalAnnual   = monthlyNZD * 12 + annualNZD
//   avgMonthly    = Math.round(totalAnnual / 12 * 100) / 100
// and formats every money value with fmtNZD = Intl "en-NZ" currency NZD → "$X.XX".
//
// Fixture chosen so the arithmetic is exact (no float drift):
//   monthly: DigitalOcean nzd 18.00 + GitHub nzd 12.00           = 30  → "$30.00"
//   annual:  Namecheap nzd 25.00 + InsureCo nzd 120.00           = 145 → "$145.00"
//   totalAnnual = 30 * 12 + 145 = 505                            → "$505.00"
//   avgMonthly  = round(505 / 12 * 100) / 100 = round(4208.33)/100 = 42.08 → "$42.08"
const SAMPLE_EXPENSES: Expense[] = [
  // Monthly — one USD item (exercises fmtOrig + currency span) and one NZD item.
  { id: "e1", supplier: "DigitalOcean", description: "Droplet hosting", category: "hosting", frequency: "monthly", currency: "USD", amount: "10.00", nzd_amount: "18.00", url: null },
  { id: "e2", supplier: "GitHub", description: "Copilot subscription", category: "software", frequency: "monthly", currency: "NZD", amount: "12.00", nzd_amount: "12.00", url: "https://github.com" },
  // Annual.
  { id: "e3", supplier: "Namecheap", description: "Domain renewal", category: "domain", frequency: "annual", currency: "NZD", amount: "25.00", nzd_amount: "25.00", url: null },
  { id: "e4", supplier: "InsureCo", description: "Public liability insurance", category: "insurance", frequency: "annual", currency: "NZD", amount: "120.00", nzd_amount: "120.00", url: null },
];

const withExpenses = [
  http.get("/api/finances/expenses", () => HttpResponse.json(SAMPLE_EXPENSES)),
];

const emptyExpenses = [
  http.get("/api/finances/expenses", () => HttpResponse.json([])),
];

const errorExpenses = [
  http.get("/api/finances/expenses", () =>
    HttpResponse.json({ error: "boom" }, { status: 500, statusText: "Internal Server Error" })),
];

const meta: Meta<typeof FinancesExpenses> = {
  title: "Pages/Finances/Expenses",
  component: FinancesExpenses,
  decorators: [(Story) => <StoryWrapper role="team"><Story /></StoryWrapper>],
};
export default meta;
type Story = StoryObj<typeof FinancesExpenses>;

export const WithData: Story = {
  parameters: { msw: { handlers: withExpenses } },
};

export const Empty: Story = {
  parameters: { msw: { handlers: emptyExpenses } },
};

export const LoadError: Story = {
  parameters: { msw: { handlers: errorExpenses } },
};

export const Loading: Story = {
  parameters: { msw: { handlers: [http.get("/api/finances/expenses", async () => { await new Promise(() => {}); })] } },
};

export const Mobile: Story = {
  parameters: {
    viewport: { defaultViewport: "mobile2" },
    msw: { handlers: withExpenses },
  },
};

// ── Behaviour tests (play functions) ─────────────────────────────────────────

/**
 * The fetched expense rows render (supplier, description, mapped category label),
 * and every client-computed total renders as its exact "$X.XX" string.
 */
export const RendersRowsAndTotals: Story = {
  parameters: { msw: { handlers: withExpenses } },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    // Rows — suppliers.
    await expect(await canvas.findByText("DigitalOcean")).toBeInTheDocument();
    await expect(canvas.getByText("GitHub")).toBeInTheDocument();
    await expect(canvas.getByText("Namecheap")).toBeInTheDocument();
    await expect(canvas.getByText("InsureCo")).toBeInTheDocument();

    // Rows — descriptions (one is rendered inside a link).
    await expect(canvas.getByText("Droplet hosting")).toBeInTheDocument();
    await expect(canvas.getByText("Copilot subscription")).toBeInTheDocument();
    await expect(canvas.getByText("Public liability insurance")).toBeInTheDocument();

    // Rows — category codes mapped through EXPENSE_CATEGORIES.
    await expect(canvas.getByText("Hosting & infrastructure")).toBeInTheDocument();
    await expect(canvas.getByText("Software & subscriptions")).toBeInTheDocument();
    await expect(canvas.getByText("Domain registration")).toBeInTheDocument();
    await expect(canvas.getByText("Insurance")).toBeInTheDocument();

    // Computed totals — each of these strings is unique on the page.
    await expect(canvas.getByText("$30.00")).toBeInTheDocument();   // Monthly total
    await expect(canvas.getByText("$145.00")).toBeInTheDocument();  // Annual total
    await expect(canvas.getByText("$505.00")).toBeInTheDocument();  // Total annual cost
    await expect(canvas.getByText("$42.08")).toBeInTheDocument();   // Average monthly cost
  },
};

/** An empty response still renders the tables; every total is "$0.00" (×4). */
export const EmptyShowsZeroTotals: Story = {
  parameters: { msw: { handlers: emptyExpenses } },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(await canvas.findByText("Monthly total")).toBeInTheDocument();
    // Monthly total, Annual total, Total annual cost, Average monthly cost.
    await expect(canvas.getAllByText("$0.00")).toHaveLength(4);
  },
};

/** A 500 from the API surfaces the "Failed to load: …" message. */
export const LoadErrorShowsMessage: Story = {
  parameters: { msw: { handlers: errorExpenses } },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    // Message is `Failed to load: ${status} ${statusText}` — matched loosely so
    // the assertion doesn't depend on the exact reason phrase.
    await expect(await canvas.findByText(/Failed to load:/)).toBeInTheDocument();
  },
};
