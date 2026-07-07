import type { Meta, StoryObj } from "@storybook/react-vite";
import { http, HttpResponse } from "msw";
import { within, expect } from "storybook/test";
import { StoryWrapper } from "../stories/MockProviders";
import NoticeBoard from "./NoticeBoard";
import type { Notice, MyNotice } from "../api/notices";

const SAMPLE_NOTICES: Notice[] = [
  {
    id: "n1",
    heading: "Road closure — Fitzherbert Street",
    body: "Fitzherbert Street will be closed between Lyon and Bell Streets from Monday 2 June to Friday 6 June for water main repairs.\n\nTraffic will be redirected via Wakefield Street.",
    notice_date: "2026-06-02",
    submitted_by_name: "Featherston Town Team",
    submitted_at: "2026-05-20T09:00:00Z",
  },
  {
    id: "n2",
    heading: "Community Hall bookings now open for 2026",
    body: "The Featherston Community Hall is now accepting bookings for the remainder of 2026. Contact the town office or visit https://featherston.co.nz/hall-bookings to make a booking.",
    notice_date: null,
    submitted_by_name: "Jane Smith",
    submitted_at: "2026-05-18T14:30:00Z",
  },
  {
    id: "n3",
    heading: "Lost cat — grey tabby, answers to Mochi",
    body: "Missing since Saturday 17 May from the Wakefield Street area. Grey tabby, neutered male, wearing a blue collar. Please call 021 555 1234 if found.",
    notice_date: null,
    submitted_by_name: null,
    submitted_at: "2026-05-17T20:00:00Z",
  },
];

const MY_NOTICES: MyNotice[] = [
  {
    id: "n4",
    heading: "Garage sale — 42 Lyon Street",
    notice_date: "2026-06-07",
    status: "pending",
    decline_reason: null,
    submitted_at: "2026-05-22T10:00:00Z",
  },
  {
    id: "n5",
    heading: "Piano lessons available",
    notice_date: null,
    status: "approved",
    decline_reason: null,
    submitted_at: "2026-05-10T08:00:00Z",
  },
  {
    id: "n6",
    heading: "SPAM SPAM SPAM",
    notice_date: null,
    status: "declined",
    decline_reason: "Does not meet community guidelines",
    submitted_at: "2026-05-05T12:00:00Z",
  },
];

const noticesHandlers = [
  http.get("/api/notices", () => HttpResponse.json(SAMPLE_NOTICES)),
  http.get("/api/notices/mine", () => HttpResponse.json(MY_NOTICES)),
  http.post("/api/notices", () => HttpResponse.json({ id: "new-notice-id" }, { status: 201 })),
  http.delete("/api/notices/:id", () => HttpResponse.json({ ok: true })),
];

const meta: Meta<typeof NoticeBoard> = {
  title: "Pages/NoticeBoard",
  component: NoticeBoard,
  decorators: [
    // Single wrapper, role driven by `parameters.role` so per-story overrides
    // don't nest a second <MemoryRouter> (which throws "cannot render a Router
    // inside another Router").
    (Story, ctx) => (
      <StoryWrapper role={(ctx.parameters.role as "public" | "team") ?? "public"}>
        <Story />
      </StoryWrapper>
    ),
  ],
};
export default meta;

type Story = StoryObj<typeof NoticeBoard>;

/** Public view — notices listed, sign-in prompt at the bottom. */
export const PublicWithNotices: Story = {
  parameters: {
    msw: { handlers: [http.get("/api/notices", () => HttpResponse.json(SAMPLE_NOTICES))] },
  },
};

/** Public view — no notices yet. */
export const PublicEmpty: Story = {
  parameters: {
    msw: { handlers: [http.get("/api/notices", () => HttpResponse.json([]))] },
  },
};

/** Logged-in user with verified email — form unlocked, own submissions visible. */
export const LoggedInWithMyNotices: Story = {
  parameters: { role: "team", msw: { handlers: noticesHandlers } },
};

/** Logged-in user with no prior submissions. */
export const LoggedInEmpty: Story = {
  parameters: {
    role: "team",
    msw: {
      handlers: [
        http.get("/api/notices", () => HttpResponse.json([])),
        http.get("/api/notices/mine", () => HttpResponse.json([])),
        http.post("/api/notices", () => HttpResponse.json({ id: "new-notice-id" }, { status: 201 })),
      ],
    },
  },
};

/** API load error. */
export const LoadError: Story = {
  parameters: {
    msw: {
      handlers: [http.get("/api/notices", () => HttpResponse.json({ error: "Server error" }, { status: 500 }))],
    },
  },
};

/** Mobile viewport. */
export const Mobile: Story = {
  parameters: {
    viewport: { defaultViewport: "mobile2" },
    msw: { handlers: [http.get("/api/notices", () => HttpResponse.json(SAMPLE_NOTICES))] },
  },
};

// ── Behaviour tests (play functions) ─────────────────────────────────────────
// MSW is active, so these assert the mocked /api/notices response actually
// renders into the notice list, and that the empty / error states show.

/** The fetched notices render as cards once /api/notices resolves. */
export const PublicNoticesRenderFromApi: Story = {
  parameters: {
    msw: { handlers: [http.get("/api/notices", () => HttpResponse.json(SAMPLE_NOTICES))] },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(await canvas.findByText("Road closure — Fitzherbert Street")).toBeInTheDocument();
    await expect(canvas.getByText("Community Hall bookings now open for 2026")).toBeInTheDocument();
    await expect(canvas.getByText("Lost cat — grey tabby, answers to Mochi")).toBeInTheDocument();
  },
};

/** An empty /api/notices response shows the "be the first" prompt. */
export const EmptyShowsPrompt: Story = {
  parameters: {
    msw: { handlers: [http.get("/api/notices", () => HttpResponse.json([]))] },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(
      await canvas.findByText("No notices yet — be the first to post one below.")
    ).toBeInTheDocument();
  },
};

/** A 500 from /api/notices surfaces the load-error alert. */
export const LoadErrorShowsAlert: Story = {
  parameters: {
    msw: {
      handlers: [http.get("/api/notices", () => HttpResponse.json({ error: "Server error" }, { status: 500 }))],
    },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(
      await canvas.findByText("Could not load notices. Please try again later.")
    ).toBeInTheDocument();
  },
};
