import type { Meta, StoryObj } from "@storybook/react-vite";
import { http, HttpResponse } from "msw";
import { within, userEvent, fireEvent, expect, fn, waitFor } from "storybook/test";
import EventInlineForm from "./EventInlineForm";

// POST /api/events succeeds so the submit path reaches its "done" state.
const handlers = [
  http.post("/api/events", () => HttpResponse.json({ id: "e-new" }, { status: 201 })),
];

// A start date one year out — always in the future, so the "past date" guard
// never trips regardless of when the suite runs. Formatted DD/MM/YYYY and set in
// one change event (the field reformats input, which makes char-by-char typing
// caret-fragile).
function futureNzDate(): string {
  const d = new Date();
  d.setFullYear(d.getFullYear() + 1);
  const dd = String(d.getDate()).padStart(2, "0");
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  return `${dd}/${mm}/${d.getFullYear()}`;
}

const LONG_DESC =
  "A friendly monthly community market with local produce, crafts and food stalls for the whole family.";

const meta: Meta<typeof EventInlineForm> = {
  title: "Events/EventInlineForm",
  component: EventInlineForm,
  parameters: { layout: "padded", msw: { handlers } },
  // onSubmitted is a spy so behaviour stories can assert it fires. Storybook
  // resets it before each play, so sharing it here is safe.
  args: { authenticated: true, emailVerified: true, onSubmitted: fn() },
};
export default meta;

type Story = StoryObj<typeof EventInlineForm>;

/** Unlocked form, ready to fill in. */
export const Default: Story = {};

/** Not signed in — the sign-in overlay covers the form. */
export const Locked: Story = {
  args: { authenticated: false, emailVerified: false },
};

/** Signed in but email not verified — the verify-email overlay covers the form. */
export const EmailUnverified: Story = {
  args: { authenticated: true, emailVerified: false },
};

// ── Behaviour tests (play functions) ─────────────────────────────────────────

/** Not signed in shows the sign-in prompt and disables the title field. */
export const LockedShowsSignInOverlay: Story = {
  args: { authenticated: false, emailVerified: false },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByText("Sign in to submit an event")).toBeInTheDocument();
    await expect(canvas.getByLabelText(/Event title/i)).toBeDisabled();
  },
};

/** Signed-in-but-unverified shows the verify-email prompt. */
export const UnverifiedShowsVerifyOverlay: Story = {
  args: { authenticated: true, emailVerified: false },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByText("Verify your email to continue")).toBeInTheDocument();
  },
};

/** Submit stays disabled until the permission checkbox is ticked. */
export const SubmitDisabledUntilPermission: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const submit = canvas.getByRole("button", { name: "Submit event" });
    await expect(submit).toBeDisabled();
    await userEvent.click(canvas.getByRole("checkbox"));
    await expect(submit).toBeEnabled();
  },
};

/** Ticking permission but leaving the description short surfaces the length error. */
export const ValidationRejectsShortDescription: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.type(canvas.getByLabelText(/Event title/i), "Test event");
    await userEvent.type(canvas.getByLabelText(/^Description/i), "too short");
    await userEvent.click(canvas.getByRole("checkbox"));
    await userEvent.click(canvas.getByRole("button", { name: "Submit event" }));
    await expect(canvas.getByText("Description must be at least 50 characters")).toBeInTheDocument();
  },
};

/**
 * Fill every required field, submit, and confirm the success state; then
 * "Submit another event" resets the form and fires onSubmitted.
 * (Image upload and the map location picker are intentionally not exercised.)
 */
export const FillAndSubmit: Story = {
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement);
    // fireEvent.change sets each controlled field in one shot — userEvent.type
    // fires a real keystroke per character in the browser, which is far too slow
    // for the ~100-char description (it re-renders the field on every key).
    fireEvent.change(canvas.getByLabelText(/Event title/i), { target: { value: "Featherston Community Market" } });
    fireEvent.change(canvas.getByLabelText(/^Description/i), { target: { value: LONG_DESC } });
    fireEvent.change(canvas.getByLabelText(/Start date/i), { target: { value: futureNzDate() } });
    fireEvent.change(canvas.getByLabelText(/Your name/i), { target: { value: "Jane Smith" } });
    fireEvent.change(canvas.getByLabelText(/Your email/i), { target: { value: "jane@example.com" } });
    fireEvent.change(canvas.getByLabelText(/Your phone/i), { target: { value: "021 000 0000" } });

    // Ticking the permission box is what enables the submit button.
    const permission = canvas.getByRole("checkbox");
    await userEvent.click(permission);
    await waitFor(() => expect(permission).toBeChecked());
    const submit = canvas.getByRole("button", { name: "Submit event" });
    await waitFor(() => expect(submit).toBeEnabled());
    await userEvent.click(submit);

    // Success alert confirms submitEvent (mocked POST) resolved and the form flipped to "done".
    await expect(await canvas.findByText(/submitted for review/i, {}, { timeout: 8000 })).toBeInTheDocument();

    await userEvent.click(canvas.getByRole("button", { name: "Submit another event" }));
    await expect(args.onSubmitted).toHaveBeenCalled();
  },
};
