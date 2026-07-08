import type { Meta, StoryObj } from "@storybook/react-vite";
import { http, HttpResponse } from "msw";
import { MemoryRouter } from "react-router-dom";
import { screen, userEvent, fireEvent, expect, fn } from "storybook/test";
import { MockKeycloakProvider } from "../../stories/MockProviders";
import EventSubmitForm from "./EventSubmitForm";

// A start date one year out — always in the future so the "past date" guard
// never trips. Native <input type="date"> wants ISO yyyy-mm-dd.
function futureDateIso(): string {
  const d = new Date();
  d.setFullYear(d.getFullYear() + 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

const meta: Meta<typeof EventSubmitForm> = {
  title: "Events/EventSubmitForm",
  component: EventSubmitForm,
  decorators: [
    (Story) => (
      <MemoryRouter>
        <MockKeycloakProvider authenticated>
          <Story />
        </MockKeycloakProvider>
      </MemoryRouter>
    ),
  ],
  // Callbacks are spies so behaviour stories can assert them. Storybook resets
  // them before each play, so sharing them here is safe.
  args: {
    open: true,
    onClose: fn(),
    onSubmitted: fn(),
  },
};
export default meta;

type Story = StoryObj<typeof EventSubmitForm>;

const successHandlers = [
  http.post("/api/events", () => HttpResponse.json({ id: "new-event-id" }, { status: 201 })),
  http.post("/api/events/:id/images", () =>
    HttpResponse.json({ file_id: "file-1", url: "https://placehold.co/400x200" }, { status: 201 })
  ),
];

/** Empty form — ready to fill in. */
export const Empty: Story = {
  parameters: { msw: { handlers: successHandlers } },
};

/** Successful submission — shows confirmation message. */
export const SubmitSuccess: Story = {
  parameters: { msw: { handlers: successHandlers } },
};

/** Server error on submit — shows error alert. */
export const SubmitError: Story = {
  parameters: {
    msw: {
      handlers: [
        http.post("/api/events", () => HttpResponse.json({ error: "Server error" }, { status: 500 })),
      ],
    },
  },
};

/** Mobile viewport. */
export const Mobile: Story = {
  parameters: {
    viewport: { defaultViewport: "mobile2" },
    msw: { handlers: successHandlers },
  },
};

// ── Behaviour tests (play functions) ─────────────────────────────────────────
// The Dialog portals to document.body, so queries use `screen`, not the canvas.
// Image upload is intentionally not exercised.

/**
 * Fill the required fields, submit, confirm the success state, then Close
 * fires onSubmitted.
 */
export const SubmitSuccessFlow: Story = {
  parameters: { msw: { handlers: successHandlers } },
  play: async ({ args }) => {
    await userEvent.type(screen.getByLabelText(/Event title/i), "Featherston Community Market");
    // Native date input — set the ISO value directly.
    fireEvent.change(screen.getByLabelText(/Start date/i), { target: { value: futureDateIso() } });
    await userEvent.click(screen.getByRole("button", { name: "Submit event" }));

    await expect(await screen.findByText(/submitted for review/i)).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Close" }));
    await expect(args.onSubmitted).toHaveBeenCalled();
  },
};

/** Submitting with an empty title surfaces the required-title error. */
export const ValidationRequiresTitle: Story = {
  parameters: { msw: { handlers: successHandlers } },
  play: async ({ args }) => {
    await userEvent.click(screen.getByRole("button", { name: "Submit event" }));
    await expect(await screen.findByText("Title is required")).toBeInTheDocument();
    await expect(args.onSubmitted).not.toHaveBeenCalled();
  },
};

/** Cancel closes the dialog via onClose. */
export const CancelCloses: Story = {
  parameters: { msw: { handlers: successHandlers } },
  play: async ({ args }) => {
    await userEvent.click(screen.getByRole("button", { name: "Cancel" }));
    await expect(args.onClose).toHaveBeenCalled();
  },
};
