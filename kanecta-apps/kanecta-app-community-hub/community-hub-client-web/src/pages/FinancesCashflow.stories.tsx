import type { Meta, StoryObj } from "@storybook/react-vite";
import { http, HttpResponse } from "msw";
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
