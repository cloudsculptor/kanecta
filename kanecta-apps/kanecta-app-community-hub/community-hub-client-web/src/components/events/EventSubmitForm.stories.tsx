import type { Meta, StoryObj } from "@storybook/react-vite";
import { within, userEvent } from "@storybook/test";
import { http, HttpResponse } from "msw";
import { MemoryRouter } from "react-router-dom";
import { MockKeycloakProvider } from "../../stories/MockProviders";
import EventSubmitForm from "./EventSubmitForm";

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
  args: {
    open: true,
    onClose: () => {},
    onSubmitted: () => {},
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
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const titleInput = canvas.getByLabelText(/event title/i);
    await userEvent.type(titleInput, "Featherston Community Market");
    const startDate = canvas.getByLabelText(/start date/i);
    await userEvent.type(startDate, "2026-06-14");
    const submitBtn = canvas.getByRole("button", { name: /submit event/i });
    await userEvent.click(submitBtn);
  },
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
