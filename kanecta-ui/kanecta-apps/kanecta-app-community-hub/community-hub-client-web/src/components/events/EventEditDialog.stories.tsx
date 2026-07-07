import type { Meta, StoryObj } from "@storybook/react-vite";
import { http, HttpResponse } from "msw";
import { screen, userEvent, expect, fn, waitFor } from "storybook/test";
import EventEditDialog from "./EventEditDialog";
import type { Event } from "../../api/events";

// A pending event with no lat/lng so the react-leaflet map picker never mounts
// (the component only renders the map when address + lat + lng are all present).
const EVENT: Event = {
  id: "1",
  title: "Featherston Community Market",
  description: "Monthly market with local produce, crafts and food stalls.",
  start_date: "2026-08-14",
  start_time: "09:00",
  end_date: "2026-08-14",
  end_time: "13:00",
  address: null,
  lat: null,
  lng: null,
  website: "https://example.com/market",
  phone: "06 308 0000",
  email: "market@example.com",
  area: "Featherston",
  organiser_name: "Jane Smith",
  organiser_email: "jane@example.com",
  organiser_phone: "021 000 0000",
  submitted_at: "2026-05-01T00:00:00Z",
  status: "pending",
  hero_image: null,
  gallery_images: [],
};

function handlers(event: Event = EVENT) {
  return [
    http.get("/api/events/:id", () => HttpResponse.json(event)),
    http.patch("/api/events/:id", () => HttpResponse.json({ ok: true, status: "pending" })),
  ];
}

const meta: Meta<typeof EventEditDialog> = {
  title: "Events/EventEditDialog",
  component: EventEditDialog,
  parameters: { msw: { handlers: handlers() } },
  // Callbacks are spies so behaviour stories can assert them. Storybook resets
  // them before each play, so sharing them here is safe.
  args: { eventId: "1", onClose: fn(), onSaved: fn() },
};
export default meta;

type Story = StoryObj<typeof EventEditDialog>;

/** Dialog open, event loaded into the fields. */
export const Default: Story = {};

/** Editing an already-approved event warns that saving resubmits for review. */
export const ApprovedEvent: Story = {
  parameters: { msw: { handlers: handlers({ ...EVENT, status: "approved" }) } },
};

// ── Behaviour tests (play functions) ─────────────────────────────────────────
// The Dialog portals to document.body, so queries use `screen`, not the canvas.

/** The fetched event populates the form fields. */
export const LoadsEventIntoFields: Story = {
  play: async () => {
    await expect(await screen.findByDisplayValue("Featherston Community Market")).toBeInTheDocument();
    await expect(screen.getByDisplayValue("jane@example.com")).toBeInTheDocument();
  },
};

/** An approved event shows the resubmit-for-review notice. */
export const ApprovedShowsResubmitNotice: Story = {
  parameters: { msw: { handlers: handlers({ ...EVENT, status: "approved" }) } },
  play: async () => {
    await expect(
      await screen.findByText(/Saving changes will resubmit it for moderator review/i)
    ).toBeInTheDocument();
  },
};

/** Editing the title and saving fires onSaved and onClose. */
export const EditAndSave: Story = {
  play: async ({ args }) => {
    const titleInput = await screen.findByDisplayValue("Featherston Community Market");
    await userEvent.clear(titleInput);
    await userEvent.type(titleInput, "Featherston Winter Market");
    await userEvent.click(screen.getByRole("button", { name: "Save changes" }));
    // Save awaits the (mocked) PATCH before firing the callbacks — wait for it.
    await waitFor(() => expect(args.onSaved).toHaveBeenCalled());
    await waitFor(() => expect(args.onClose).toHaveBeenCalled());
  },
};

/** Clearing the required title blocks the save with a validation error. */
export const ValidationRequiresTitle: Story = {
  play: async ({ args }) => {
    const titleInput = await screen.findByDisplayValue("Featherston Community Market");
    await userEvent.clear(titleInput);
    await userEvent.click(screen.getByRole("button", { name: "Save changes" }));
    await expect(await screen.findByText("Title is required")).toBeInTheDocument();
    await expect(args.onSaved).not.toHaveBeenCalled();
  },
};

/** Cancel closes the dialog without saving. */
export const CancelCloses: Story = {
  play: async ({ args }) => {
    await screen.findByDisplayValue("Featherston Community Market");
    await userEvent.click(screen.getByRole("button", { name: "Cancel" }));
    await expect(args.onClose).toHaveBeenCalled();
    await expect(args.onSaved).not.toHaveBeenCalled();
  },
};
