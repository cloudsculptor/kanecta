import type { Meta, StoryObj } from "@storybook/react-vite";
import { http, HttpResponse } from "msw";
import { within, expect } from "storybook/test";
import { StoryWrapper } from "../stories/MockProviders";
import FinancesTransactions from "./FinancesTransactions";

// NOTE: ids are strings — the component renders `t.id.slice(0, 8)`, so numeric
// ids would throw once MSW actually loads this data into the table.
const SAMPLE_TRANSACTIONS = [
  { id: "1", date: "2025-07-01", description: "Annual domain renewal", amount: "25.00", type: "expense", category: "domain", reference: "INV-001", created_by_name: "Richard Thomas", created_at: "2025-07-01T00:00:00Z" },
  { id: "2", date: "2025-07-15", description: "Member contribution — Alice", amount: "20.00", type: "income", category: "membership", reference: null, created_by_name: "Richard Thomas", created_at: "2025-07-15T00:00:00Z" },
  { id: "3", date: "2025-08-01", description: "DigitalOcean hosting", amount: "18.00", type: "expense", category: "hosting", reference: "DO-AUG", created_by_name: "Richard Thomas", created_at: "2025-08-01T00:00:00Z" },
  { id: "4", date: "2025-08-10", description: "Member contribution — Bob", amount: "10.00", type: "income", category: "membership", reference: null, created_by_name: "Richard Thomas", created_at: "2025-08-10T00:00:00Z" },
];

const withTransactions = [
  http.get("/api/finances/transactions", () => HttpResponse.json(SAMPLE_TRANSACTIONS)),
];

const meta: Meta<typeof FinancesTransactions> = {
  title: "Pages/Finances/Transactions",
  component: FinancesTransactions,
  decorators: [(Story) => <StoryWrapper role="team"><Story /></StoryWrapper>],
};
export default meta;
type Story = StoryObj<typeof FinancesTransactions>;

export const WithData: Story = {
  parameters: { msw: { handlers: withTransactions } },
};

export const Empty: Story = {
  parameters: { msw: { handlers: [http.get("/api/finances/transactions", () => HttpResponse.json([]))] } },
};

export const Loading: Story = {
  parameters: { msw: { handlers: [http.get("/api/finances/transactions", async () => { await new Promise(() => {}); })] } },
};

export const GuestBlocked: Story = {
  decorators: [(Story) => <StoryWrapper role="guest"><Story /></StoryWrapper>],
};

export const Mobile: Story = {
  parameters: {
    viewport: { defaultViewport: "mobile2" },
    msw: { handlers: withTransactions },
  },
};

// ── Behaviour tests (play functions) ─────────────────────────────────────────
// Assert the mocked /api/finances/transactions response renders into the table.

/** Transaction rows render with description and category once data loads. */
export const RendersTransactionRows: Story = {
  parameters: { msw: { handlers: withTransactions } },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(await canvas.findByText("Annual domain renewal")).toBeInTheDocument();
    await expect(canvas.getByText("Member contribution — Alice")).toBeInTheDocument();
    await expect(canvas.getByText("DigitalOcean hosting")).toBeInTheDocument();
    // Category codes are mapped to human labels via ALL_CATEGORIES.
    await expect(canvas.getByText("Domain registration")).toBeInTheDocument();
  },
};

/** An empty response shows the table's empty-row message. */
export const EmptyShowsNoTransactions: Story = {
  parameters: { msw: { handlers: [http.get("/api/finances/transactions", () => HttpResponse.json([]))] } },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(await canvas.findByText("No transactions recorded yet.")).toBeInTheDocument();
  },
};
