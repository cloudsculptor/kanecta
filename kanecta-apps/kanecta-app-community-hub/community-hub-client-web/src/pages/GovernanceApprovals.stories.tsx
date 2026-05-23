import type { Meta, StoryObj } from "@storybook/react-vite";
import { http, HttpResponse } from "msw";
import { StoryWrapper } from "../stories/MockProviders";
import GovernanceApprovals from "./GovernanceApprovals";
import type { Event } from "../api/events";

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
    submitted_at: "2026-05-20T08:30:00Z",
    submitted_by_name: "Jane Smith",
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
    submitted_at: "2026-05-21T14:00:00Z",
    submitted_by_name: "Tom Brown",
    hero_image: null,
    gallery_images: [],
  },
];

const meta: Meta<typeof GovernanceApprovals> = {
  title: "Pages/GovernanceApprovals",
  component: GovernanceApprovals,
  decorators: [(Story) => <StoryWrapper role="moderator"><Story /></StoryWrapper>],
};
export default meta;

type Story = StoryObj<typeof GovernanceApprovals>;

/** Two pending events waiting for review. */
export const WithPendingEvents: Story = {
  parameters: {
    msw: {
      handlers: [
        http.get("/api/events/pending", () => HttpResponse.json(PENDING_EVENTS)),
        http.patch("/api/events/:id/approve", () => HttpResponse.json({ ok: true })),
        http.patch("/api/events/:id/decline", () => HttpResponse.json({ ok: true })),
      ],
    },
  },
};

/** Empty queue — nothing to review. */
export const EmptyQueue: Story = {
  parameters: {
    msw: {
      handlers: [http.get("/api/events/pending", () => HttpResponse.json([]))],
    },
  },
};

/** API error loading the queue. */
export const LoadError: Story = {
  parameters: {
    msw: {
      handlers: [
        http.get("/api/events/pending", () => HttpResponse.json({ error: "Server error" }, { status: 500 })),
      ],
    },
  },
};

/** Mobile viewport. */
export const Mobile: Story = {
  parameters: {
    viewport: { defaultViewport: "mobile2" },
    msw: {
      handlers: [http.get("/api/events/pending", () => HttpResponse.json(PENDING_EVENTS))],
    },
  },
};
