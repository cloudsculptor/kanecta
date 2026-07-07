import type { Meta, StoryObj } from "@storybook/react-vite";
import { screen, userEvent, expect, fn, waitFor } from "storybook/test";
import CreateThreadModal from "./CreateThreadModal";
import { DuplicateThreadError } from "../../api/discussions";

const meta: Meta<typeof CreateThreadModal> = {
  title: "Discussions/CreateThreadModal",
  component: CreateThreadModal,
  // Callbacks are fn() spies so behaviour stories can assert they fire. Storybook
  // resets them before each story's play, so sharing them here is safe.
  args: {
    open: true,
    onClose: fn(),
    onCreate: fn(),
    onGoToThread: fn(),
  },
};
export default meta;
type Story = StoryObj<typeof CreateThreadModal>;

export const Open: Story = {};

export const Closed: Story = {
  args: { open: false },
};

/** onCreate resolves after a short delay — Create button shows "Creating…" while saving. */
export const SlowCreate: Story = {
  args: {
    onCreate: async (name, desc) => {
      await new Promise((r) => setTimeout(r, 1200));
      console.log("created:", name, desc);
    },
  },
};

/**
 * Submitting a name that matches an existing thread (case/whitespace insensitive)
 * returns a 409. The modal shows the matching thread name and description, plus
 * a "Go to #thread" button that navigates directly to it.
 */
export const DuplicateThread: Story = {
  args: {
    onCreate: async () => {
      throw new DuplicateThreadError({
        id: "t1",
        name: "General",
        description: "Day-to-day chat for the team",
        created_by_name: "Jane Smith",
        created_by_user_id: "user-1",
        created_at: new Date().toISOString(),
        has_unread: false, is_notifications_enabled: false,
      });
    },
  },
};

/**
 * Same duplicate error but without an onGoToThread handler — the warning
 * shows the thread name/description but no navigation button.
 */
export const DuplicateThreadNoNavigation: Story = {
  args: {
    onGoToThread: undefined,
    onCreate: async () => {
      throw new DuplicateThreadError({
        id: "t1",
        name: "General",
        description: "Day-to-day chat for the team",
        created_by_name: "Jane Smith",
        created_by_user_id: "user-1",
        created_at: new Date().toISOString(),
        has_unread: false, is_notifications_enabled: false,
      });
    },
  },
};

// ── Behaviour tests (play functions) ─────────────────────────────────────────
// The dialog portals to document.body, so these query via `screen`, not the
// story canvas. Pin the create/validate/duplicate contract.

/** The open modal renders its title, both fields, and the action buttons. */
export const RendersFields: Story = {
  play: async () => {
    await expect(await screen.findByText("New Thread")).toBeInTheDocument();
    await expect(screen.getByLabelText("Thread name")).toBeInTheDocument();
    await expect(screen.getByLabelText("Description (optional)")).toBeInTheDocument();
    await expect(screen.getByRole("button", { name: "Create" })).toBeInTheDocument();
    await expect(screen.getByRole("button", { name: "Cancel" })).toBeInTheDocument();
  },
};

/** Submitting with an empty name shows a validation error and does not call onCreate. */
export const EmptyNameShowsError: Story = {
  play: async ({ args }) => {
    await userEvent.click(await screen.findByRole("button", { name: "Create" }));
    await expect(await screen.findByText("Thread name is required")).toBeInTheDocument();
    await expect(args.onCreate).not.toHaveBeenCalled();
  },
};

/** Typing a name and clicking Create calls onCreate with the trimmed name and no description, then closes. */
export const CreatesWithName: Story = {
  play: async ({ args }) => {
    await userEvent.type(await screen.findByLabelText("Thread name"), "  Weekend Market  ");
    await userEvent.click(screen.getByRole("button", { name: "Create" }));
    await waitFor(() => expect(args.onCreate).toHaveBeenCalledWith("Weekend Market", undefined));
    await waitFor(() => expect(args.onClose).toHaveBeenCalled());
  },
};

/** Filling both fields calls onCreate with the name and the trimmed description. */
export const CreatesWithNameAndDescription: Story = {
  play: async ({ args }) => {
    await userEvent.type(await screen.findByLabelText("Thread name"), "Bake Sale");
    await userEvent.type(screen.getByLabelText("Description (optional)"), "Fundraiser planning");
    await userEvent.click(screen.getByRole("button", { name: "Create" }));
    await waitFor(() => expect(args.onCreate).toHaveBeenCalledWith("Bake Sale", "Fundraiser planning"));
  },
};

/** Pressing Enter in the name field submits, same as clicking Create. */
export const EnterKeySubmits: Story = {
  play: async ({ args }) => {
    await userEvent.type(await screen.findByLabelText("Thread name"), "Quiz Night{Enter}");
    await waitFor(() => expect(args.onCreate).toHaveBeenCalledWith("Quiz Night", undefined));
  },
};

/** Clicking Cancel calls onClose without creating anything. */
export const CancelCallsOnClose: Story = {
  play: async ({ args }) => {
    await userEvent.click(await screen.findByRole("button", { name: "Cancel" }));
    await expect(args.onClose).toHaveBeenCalled();
    await expect(args.onCreate).not.toHaveBeenCalled();
  },
};

/** A duplicate-name error surfaces the existing thread and a "Go to" button that navigates to it. */
export const DuplicateOffersGoToThread: Story = {
  args: {
    onCreate: async () => {
      throw new DuplicateThreadError({
        id: "t1", name: "General", description: "Day-to-day chat for the team",
        created_by_name: "Jane Smith", created_by_user_id: "user-1",
        created_at: new Date().toISOString(),
        has_unread: false, is_notifications_enabled: false,
      });
    },
  },
  play: async ({ args }) => {
    await userEvent.type(await screen.findByLabelText("Thread name"), "General");
    await userEvent.click(screen.getByRole("button", { name: "Create" }));
    await expect(await screen.findByText(/already exists/)).toBeInTheDocument();
    await userEvent.click(await screen.findByRole("button", { name: "Go to #General" }));
    await waitFor(() => expect(args.onGoToThread).toHaveBeenCalledWith("t1"));
    await waitFor(() => expect(args.onClose).toHaveBeenCalled());
  },
};
