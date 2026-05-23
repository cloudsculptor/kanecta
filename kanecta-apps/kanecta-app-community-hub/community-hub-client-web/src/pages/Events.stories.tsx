import type { Meta, StoryObj } from "@storybook/react-vite";
import { http, HttpResponse } from "msw";
import { StoryWrapper } from "../stories/MockProviders";
import Events from "./Events";
import type { Event } from "../api/events";

const SAMPLE_EVENTS: Event[] = [
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
    email: null,
    address: "Featherston Domain, Featherston 5710",
    lat: -41.1167,
    lng: 175.3333,
    submitted_at: "2026-05-01T00:00:00Z",
    organiser_name: "Jane Smith", organiser_email: "jane@example.com", organiser_phone: "021 000 0000",
    hero_image: { file_id: "f1", url: "https://placehold.co/800x300/3a7d44/fff?text=Market" },
    gallery_images: [],
  },
  {
    id: "e2",
    title: "Featherston Booktown Festival",
    description: "Annual literary festival celebrating books and reading.",
    start_date: "2026-06-28",
    start_time: "10:00",
    end_date: "2026-06-30",
    end_time: "17:00",
    website: "https://www.booktown.org.nz/",
    phone: null,
    email: "info@booktown.org.nz",
    address: null,
    lat: null,
    lng: null,
    submitted_at: "2026-05-10T00:00:00Z",
    organiser_name: "Tom Brown", organiser_email: "tom@example.com", organiser_phone: "021 111 1111",
    hero_image: { file_id: "f2", url: "https://placehold.co/800x300/1a4d22/fff?text=Booktown" },
    gallery_images: [
      { file_id: "f3", url: "https://placehold.co/200x150/2d6a35/fff?text=Photo+1", position: 0 },
      { file_id: "f4", url: "https://placehold.co/200x150/5aad68/fff?text=Photo+2", position: 1 },
    ],
  },
  {
    id: "e3",
    title: "Martinborough Fair",
    description: null,
    start_date: "2026-07-05",
    start_time: null,
    end_date: null,
    end_time: null,
    website: "https://martinboroughfair.org.nz/",
    phone: null,
    email: null,
    address: null,
    lat: null,
    lng: null,
    submitted_at: "2026-05-12T00:00:00Z",
    organiser_name: "Alice Green", organiser_email: "alice@example.com", organiser_phone: "021 222 2222",
    hero_image: null,
    gallery_images: [],
  },
];

const meta: Meta<typeof Events> = {
  title: "Pages/Events",
  component: Events,
  decorators: [(Story) => <StoryWrapper role="public"><Story /></StoryWrapper>],
};
export default meta;

type Story = StoryObj<typeof Events>;

/** Public view — events listed, sign-in prompt at bottom. */
export const PublicWithEvents: Story = {
  parameters: {
    msw: { handlers: [http.get("/api/events", () => HttpResponse.json(SAMPLE_EVENTS))] },
  },
};

/** Public view — no events yet. */
export const PublicEmpty: Story = {
  parameters: {
    msw: { handlers: [http.get("/api/events", () => HttpResponse.json([]))] },
  },
};

/** Logged-in user with verified email — shows "Submit an event" button. */
export const LoggedInVerified: Story = {
  decorators: [(Story) => <StoryWrapper role="team"><Story /></StoryWrapper>],
  parameters: {
    msw: { handlers: [http.get("/api/events", () => HttpResponse.json(SAMPLE_EVENTS))] },
  },
};

/** API load error. */
export const LoadError: Story = {
  parameters: {
    msw: {
      handlers: [http.get("/api/events", () => HttpResponse.json({ error: "Server error" }, { status: 500 }))],
    },
  },
};

/** Mobile viewport. */
export const Mobile: Story = {
  parameters: {
    viewport: { defaultViewport: "mobile2" },
    msw: { handlers: [http.get("/api/events", () => HttpResponse.json(SAMPLE_EVENTS))] },
  },
};
