import type { Meta, StoryObj } from "@storybook/react-vite";
import { MemoryRouter } from "react-router-dom";
import { within, userEvent, expect, fn } from "storybook/test";
import EventCard from "./EventCard";
import type { Event } from "../../api/events";

const BASE: Event = {
  id: "1",
  title: "Featherston Community Market",
  description: "Monthly community market with local produce, crafts, and food stalls. Bring the family!",
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
  submitted_at: "2026-05-01T00:00:00Z",
  area: "Featherston",
  organiser_name: "Jane Smith", organiser_email: "jane@example.com", organiser_phone: "021 000 0000",
  hero_image: { file_id: "f1", url: "https://placehold.co/800x300/3a7d44/fff?text=Market" },
  gallery_images: [
    { file_id: "f2", url: "https://placehold.co/200x150/5aad68/fff?text=Stall+1", position: 0 },
    { file_id: "f3", url: "https://placehold.co/200x150/2d6a35/fff?text=Stall+2", position: 1 },
  ],
};

const meta: Meta<typeof EventCard> = {
  title: "Events/EventCard",
  component: EventCard,
  decorators: [(Story) => <MemoryRouter><Story /></MemoryRouter>],
  parameters: { layout: "padded" },
};
export default meta;

type Story = StoryObj<typeof EventCard>;

/** Upcoming event with hero image and gallery. */
export const Upcoming: Story = {
  args: { event: BASE, past: false },
};

/** Past event — greyed out. */
export const Past: Story = {
  args: { event: { ...BASE, title: "Last Month's Market" }, past: true },
};

/** No images at all. */
export const NoImages: Story = {
  args: {
    event: { ...BASE, hero_image: null, gallery_images: [] },
    past: false,
  },
};

/** Date only — no start or end time. */
export const DateOnly: Story = {
  args: {
    event: { ...BASE, start_time: null, end_time: null, hero_image: null, gallery_images: [] },
    past: false,
  },
};

/** Single-day event spanning a time range. */
export const TimeRange: Story = {
  args: {
    event: { ...BASE, hero_image: null, gallery_images: [] },
    past: false,
  },
};

/** Multi-day event. */
export const MultiDay: Story = {
  args: {
    event: {
      ...BASE,
      title: "Featherston Booktown Festival",
      start_date: "2026-05-08",
      start_time: "10:00",
      end_date: "2026-05-10",
      end_time: "17:00",
      hero_image: { file_id: "f1", url: "https://placehold.co/800x300/3a7d44/fff?text=Booktown" },
      gallery_images: [],
    },
    past: false,
  },
};

/** Minimal — title and date only, no contact details or images. */
export const Minimal: Story = {
  args: {
    event: {
      ...BASE,
      description: null,
      website: null,
      phone: null,
      email: null,
      hero_image: null,
      gallery_images: [],
    },
    past: false,
  },
};

/** Mobile viewport. */
export const Mobile: Story = {
  args: { event: BASE, past: false },
  parameters: { viewport: { defaultViewport: "mobile2" } },
};

/** Moderator view — delete button visible. */
export const WithModeratorDelete: Story = {
  args: {
    event: BASE,
    past: false,
    onDelete: fn(),
  },
};

// ── Behaviour tests (play functions) ─────────────────────────────────────────

/** The card renders its title, date, description, address link and contact links. */
export const RendersEventDetails: Story = {
  args: { event: BASE, past: false },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByText("Featherston Community Market")).toBeInTheDocument();
    await expect(canvas.getByText(/Monthly community market/)).toBeInTheDocument();
    await expect(
      canvas.getByRole("link", { name: "Featherston Domain, Featherston 5710" })
    ).toBeInTheDocument();
    await expect(canvas.getByRole("link", { name: "example.com/market" })).toBeInTheDocument();
    await expect(canvas.getByRole("link", { name: "market@example.com" })).toHaveAttribute(
      "href",
      "mailto:market@example.com"
    );
  },
};

/** Without an onDelete handler, the options menu is not rendered. */
export const NoMenuWithoutOnDelete: Story = {
  args: { event: BASE, past: false },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.queryByRole("button", { name: "Event options" })).not.toBeInTheDocument();
  },
};

/** Delete requires a two-step confirm before onDelete fires. */
export const DeleteConfirmFlow: Story = {
  args: { event: BASE, past: false, onDelete: fn() },
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByRole("button", { name: "Event options" }));
    await userEvent.click(canvas.getByRole("button", { name: "Delete" }));
    // First click only arms the confirm — nothing deleted yet.
    await expect(args.onDelete).not.toHaveBeenCalled();
    await userEvent.click(canvas.getByRole("button", { name: "Confirm delete" }));
    await expect(args.onDelete).toHaveBeenCalled();
  },
};

/** Cancelling the confirm step keeps the event and fires nothing. */
export const DeleteCancelKeepsEvent: Story = {
  args: { event: BASE, past: false, onDelete: fn() },
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByRole("button", { name: "Event options" }));
    await userEvent.click(canvas.getByRole("button", { name: "Delete" }));
    await userEvent.click(canvas.getByRole("button", { name: "Cancel" }));
    await expect(canvas.getByRole("button", { name: "Delete" })).toBeInTheDocument();
    await expect(args.onDelete).not.toHaveBeenCalled();
  },
};
