import type { Meta, StoryObj } from "@storybook/react-vite";
import { http, HttpResponse } from "msw";
import { StoryWrapper } from "../stories/MockProviders";
import GovernanceApprovals from "./GovernanceApprovals";
import type { Event } from "../api/events";
import type { Notice } from "../api/notices";

const PENDING_EVENTS: Event[] = [
  {
    id: "e1",
    title: "Featherston Community Market",
    description: "Monthly market with local produce, crafts, and food stalls.",
    start_date: "2026-06-14",
    start_time: "09:00",
    end_date: "2026-06-14",
    end_time: "13:00",
    website: "https://example.com/market",
    phone: "06 308 0000",
    email: "market@example.com",
    address: "Featherston Domain, Featherston 5710",
    lat: -41.1167,
    lng: 175.3333,
    submitted_at: "2026-05-20T08:30:00Z",
    area: "Featherston",
    submitted_by_name: "Jane Smith",
    organiser_name: "Jane Smith", organiser_email: "jane@example.com", organiser_phone: "021 000 0000",
    hero_image: { file_id: "f1", url: "https://placehold.co/600x250/3a7d44/fff?text=Market" },
    gallery_images: [
      { file_id: "f2", url: "https://placehold.co/200x150/5aad68/fff?text=Photo+1", position: 0 },
    ],
  },
  {
    id: "e2",
    title: "Wairarapa Wine & Food Festival",
    description: null,
    start_date: "2026-07-04",
    start_time: null,
    end_date: null,
    end_time: null,
    website: null,
    phone: null,
    email: "info@festival.nz",
    address: null,
    lat: null,
    lng: null,
    submitted_at: "2026-05-21T14:00:00Z",
    area: "Wairarapa",
    submitted_by_name: "Tom Brown",
    organiser_name: "Tom Brown", organiser_email: "tom@example.com", organiser_phone: "021 111 1111",
    hero_image: null,
    gallery_images: [],
  },
];

const PENDING_NOTICES: Notice[] = [
  {
    id: "n1",
    heading: "Road closure — Fitzherbert Street",
    body: "Fitzherbert Street will be closed between Lyon and Bell Streets from Monday 2 June to Friday 6 June for water main repairs.",
    notice_date: "2026-06-02",
    submitted_by_name: "Featherston Town Team",
    submitted_at: "2026-05-20T09:00:00Z",
  },
  {
    id: "n2",
    heading: "Lost cat — grey tabby, answers to Mochi",
    body: "Missing since Saturday 17 May from the Wakefield Street area. Grey tabby, neutered male, blue collar. Call 021 555 1234 if found.",
    notice_date: null,
    submitted_by_name: null,
    submitted_at: "2026-05-17T20:00:00Z",
  },
];

const baseHandlers = [
  http.get("/api/events/pending", () => HttpResponse.json(PENDING_EVENTS)),
  http.patch("/api/events/:id/approve", () => HttpResponse.json({ ok: true })),
  http.patch("/api/events/:id/decline", () => HttpResponse.json({ ok: true })),
  http.get("/api/notices/pending", () => HttpResponse.json(PENDING_NOTICES)),
  http.patch("/api/notices/:id/approve", () => HttpResponse.json({ ok: true })),
  http.patch("/api/notices/:id/decline", () => HttpResponse.json({ ok: true })),
  http.get("/api/suggestions", () => HttpResponse.json([])),
];

const meta: Meta<typeof GovernanceApprovals> = {
  title: "Pages/GovernanceApprovals",
  component: GovernanceApprovals,
  decorators: [(Story) => <StoryWrapper role="moderator"><Story /></StoryWrapper>],
};
export default meta;

type Story = StoryObj<typeof GovernanceApprovals>;

/** Pending events and notices waiting for review. */
export const WithPendingItems: Story = {
  parameters: { msw: { handlers: baseHandlers } },
};

/** Empty queue — nothing to review. */
export const EmptyQueue: Story = {
  parameters: {
    msw: {
      handlers: [
        http.get("/api/events/pending", () => HttpResponse.json([])),
        http.get("/api/notices/pending", () => HttpResponse.json([])),
        http.get("/api/suggestions", () => HttpResponse.json([])),
      ],
    },
  },
};

/** API error loading the events queue. */
export const LoadError: Story = {
  parameters: {
    msw: {
      handlers: [
        http.get("/api/events/pending", () => HttpResponse.json({ error: "Server error" }, { status: 500 })),
        http.get("/api/notices/pending", () => HttpResponse.json([])),
        http.get("/api/suggestions", () => HttpResponse.json([])),
      ],
    },
  },
};

/** Mobile viewport. */
export const Mobile: Story = {
  parameters: {
    viewport: { defaultViewport: "mobile2" },
    msw: { handlers: baseHandlers },
  },
};
