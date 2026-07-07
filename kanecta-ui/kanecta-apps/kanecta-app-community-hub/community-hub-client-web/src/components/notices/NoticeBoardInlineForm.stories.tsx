import type { Meta, StoryObj } from "@storybook/react-vite";
import { http, HttpResponse } from "msw";
import { within, userEvent, fireEvent, expect, fn } from "storybook/test";
import NoticeBoardInlineForm from "./NoticeBoardInlineForm";

// POST /api/notices succeeds so the submit path reaches its "done" state.
const handlers = [
  http.post("/api/notices", () => HttpResponse.json({ id: "n-new" }, { status: 201 })),
];

const meta: Meta<typeof NoticeBoardInlineForm> = {
  title: "Notices/NoticeBoardInlineForm",
  component: NoticeBoardInlineForm,
  parameters: { layout: "padded", msw: { handlers } },
  // onSubmitted is a spy so behaviour stories can assert it fires. Storybook
  // resets it before each play, so sharing it here is safe.
  args: { authenticated: true, emailVerified: true, onSubmitted: fn() },
};
export default meta;

type Story = StoryObj<typeof NoticeBoardInlineForm>;

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

/** Not signed in shows the sign-in prompt and disables the heading field. */
export const LockedShowsSignInOverlay: Story = {
  args: { authenticated: false, emailVerified: false },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByText("Sign in to post a notice")).toBeInTheDocument();
    await expect(canvas.getByLabelText(/Heading/i)).toBeDisabled();
  },
};

/** Submitting with an empty heading surfaces the required-heading error. */
export const ValidationRequiresHeading: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByRole("button", { name: "Submit notice" }));
    await expect(canvas.getByText("Heading is required")).toBeInTheDocument();
  },
};

/** Heading without body text surfaces the required-body error. */
export const ValidationRequiresBody: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.type(canvas.getByLabelText(/Heading/i), "Community picnic");
    await userEvent.click(canvas.getByRole("button", { name: "Submit notice" }));
    await expect(canvas.getByText("Body text is required")).toBeInTheDocument();
  },
};

/** An invalid date blocks submission with a format error. */
export const ValidationRejectsBadDate: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.type(canvas.getByLabelText(/Heading/i), "Community picnic");
    await userEvent.type(canvas.getByLabelText(/Notice text/i), "Bring a plate to share.");
    // Set in one change event; the field reformats input, making typing fragile.
    fireEvent.change(canvas.getByLabelText(/Date/i), { target: { value: "99/99/9999" } });
    await userEvent.click(canvas.getByRole("button", { name: "Submit notice" }));
    await expect(canvas.getByText("Enter date as DD/MM/YYYY")).toBeInTheDocument();
  },
};

/**
 * Fill the required fields, submit, and confirm the success state; then
 * "Post another notice" resets the form and fires onSubmitted.
 */
export const FillAndSubmit: Story = {
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement);
    await userEvent.type(canvas.getByLabelText(/Heading/i), "Garage sale this Saturday");
    await userEvent.type(
      canvas.getByLabelText(/Notice text/i),
      "Household goods, books and plants. 42 Lyon Street, from 9am."
    );
    await userEvent.click(canvas.getByRole("button", { name: "Submit notice" }));

    // Success alert confirms submitNotice resolved and the form flipped to "done".
    await expect(await canvas.findByText(/submitted for review/i)).toBeInTheDocument();

    await userEvent.click(canvas.getByRole("button", { name: "Post another notice" }));
    await expect(args.onSubmitted).toHaveBeenCalled();
  },
};
