import type { Meta, StoryObj } from "@storybook/react-vite";
import { within, expect } from "storybook/test";
import NoticeCard from "./NoticeCard";
import type { Notice } from "../../api/notices";

const BASE: Notice = {
  id: "n1",
  heading: "Road closure — Fitzherbert Street",
  body: "Fitzherbert Street will be closed between Lyon and Bell Streets from Monday 2 June to Friday 6 June for water main repairs.\n\nTraffic will be redirected via Wakefield Street. Allow extra travel time during this period.",
  notice_date: "2026-06-02",
  submitted_by_name: "Featherston Town Team",
  submitted_at: "2026-05-20T09:00:00Z",
};

const meta: Meta<typeof NoticeCard> = {
  title: "Notices/NoticeCard",
  component: NoticeCard,
  parameters: { layout: "padded" },
};
export default meta;

type Story = StoryObj<typeof NoticeCard>;

/** Standard notice with date and submitter name. */
export const WithDate: Story = {
  args: { notice: BASE },
};

/** Notice without a specific date — just a general announcement. */
export const NoDate: Story = {
  args: { notice: { ...BASE, notice_date: null, heading: "New recycling drop-off point now open" } },
};

/** Long body text to check wrapping and overflow. */
export const LongBody: Story = {
  args: {
    notice: {
      ...BASE,
      heading: "Featherston Community Hall bookings now open",
      body: "The Featherston Community Hall is now accepting bookings for 2026. The hall is available for community events, meetings, birthdays, and private functions.\n\nCapacity: 120 seated, 200 standing.\nKitchen: full commercial kitchen available.\nParking: on-site parking for 40 vehicles.\n\nTo make a booking, visit https://featherston.co.nz/hall-bookings or call the town office on 06 308 8200.\n\nNote: A refundable bond of $200 applies for all bookings. The hall must be left clean and tidy at the end of your event.",
      notice_date: null,
    },
  },
};

/** Notice with a URL in the body — should be auto-linked. */
export const WithLink: Story = {
  args: {
    notice: {
      ...BASE,
      heading: "Consultation open — Featherston Reserve management plan",
      body: "Have your say on the management plan for Featherston Reserve. Submissions are open until 30 June 2026.\n\nRead the draft plan and submit feedback at https://southwairarapa.govt.nz/featherston-reserve",
      notice_date: "2026-06-30",
    },
  },
};

/** No submitter name — shows fallback "Community member". */
export const AnonymousSubmitter: Story = {
  args: { notice: { ...BASE, submitted_by_name: null } },
};

/** Mobile viewport. */
export const Mobile: Story = {
  args: { notice: BASE },
  parameters: { viewport: { defaultViewport: "mobile2" } },
};

// ── Behaviour tests (play functions) ─────────────────────────────────────────
// NoticeCard has no callbacks — these pin what it renders from its data.

/** Heading, body and submitter name all render. */
export const RendersNoticeContent: Story = {
  args: { notice: BASE },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByText("Road closure — Fitzherbert Street")).toBeInTheDocument();
    await expect(canvas.getByText(/Fitzherbert Street will be closed/)).toBeInTheDocument();
    await expect(canvas.getByText(/Featherston Town Team/)).toBeInTheDocument();
  },
};

/** With no submitter name, the card falls back to "Community member". */
export const AnonymousShowsFallback: Story = {
  args: { notice: { ...BASE, submitted_by_name: null } },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByText(/Community member/)).toBeInTheDocument();
  },
};

/** A URL in the body is turned into an anchor pointing at that URL. */
export const LinkifiesUrlInBody: Story = {
  args: {
    notice: {
      ...BASE,
      heading: "Consultation open",
      body: "Read the draft plan at https://southwairarapa.govt.nz/reserve",
    },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const link = canvas.getByRole("link", { name: "https://southwairarapa.govt.nz/reserve" });
    await expect(link).toHaveAttribute("href", "https://southwairarapa.govt.nz/reserve");
  },
};
