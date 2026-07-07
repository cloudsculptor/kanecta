import type { Meta, StoryObj } from "@storybook/react-vite";
import { MemoryRouter } from "react-router-dom";
import { within, userEvent, expect, fn } from "storybook/test";
import MessageItem from "./MessageItem";
import type { MessageFile } from "../../api/discussions";

const PLACEHOLDER_IMAGE = "data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSIzMjAiIGhlaWdodD0iMjAwIj48cmVjdCB3aWR0aD0iMzIwIiBoZWlnaHQ9IjIwMCIgZmlsbD0iIzNhN2Q0NCIvPjwvc3ZnPg==";

const imgFile: MessageFile = {
  id: "mf1", file_id: "f1", name: "market-photo.jpg", mime_type: "image/jpeg",
  size_bytes: 142_000, url: PLACEHOLDER_IMAGE, show_preview: true,
};

const imgFileHidden: MessageFile = { ...imgFile, id: "mf2", show_preview: false };

const pdfFile: MessageFile = {
  id: "mf3", file_id: "f3", name: "weekend-agenda.pdf", mime_type: "application/pdf",
  size_bytes: 82_500, url: "#", show_preview: true,
};

const base = {
  id: "m1", thread_id: "t1", parent_message_id: null,
  user_id: "user-1", user_name: "Jane Smith",
  content: "Hey everyone, what's the plan for the weekend market?",
  created_at: new Date().toISOString(), edited_at: null, deleted_at: null, reply_count: 0,
  files: [] as MessageFile[],
};

const meta: Meta<typeof MessageItem> = {
  title: "Discussions/MessageItem",
  component: MessageItem,
  decorators: [(Story) => <MemoryRouter><div style={{ padding: 20, maxWidth: 600 }}><Story /></div></MemoryRouter>],
  // Callbacks are fn() spies so behaviour stories can assert they fire. Storybook
  // resets them before each story's play, so sharing them here is safe.
  args: {
    message: base, reactions: [], currentUserId: "user-1",
    canModerate: false, onEdit: fn(), onDelete: fn(),
    onReact: fn(), onUnreact: fn(), onOpenReplies: fn(),
  },
};
export default meta;
type Story = StoryObj<typeof MessageItem>;

export const Default: Story = {};

export const OtherUser: Story = {
  args: { currentUserId: "user-2" },
};

export const WithReplies: Story = {
  args: { message: { ...base, reply_count: 5 } },
};

export const Edited: Story = {
  args: { message: { ...base, edited_at: new Date().toISOString() } },
};

export const Deleted: Story = {
  args: { message: { ...base, deleted_at: new Date().toISOString(), content: "" } },
};

export const WithReactions: Story = {
  args: {
    reactions: [
      { emoji: "👍", count: "3", user_ids: ["user-1", "user-2", "user-3"], user_names: ["Jane Smith", "Mike R.", "Aroha T."] },
      { emoji: "❤️", count: "1", user_ids: ["user-2"], user_names: ["Mike R."] },
    ],
  },
};

export const ModeratorView: Story = {
  args: { currentUserId: "user-2", canModerate: true },
};

export const WithUrl: Story = {
  args: { message: { ...base, content: "Check out https://featherston.co.nz for more info." } },
};

export const WithUrlOnly: Story = {
  args: { message: { ...base, content: "https://featherston.co.nz" } },
};

export const WithMultipleUrls: Story = {
  args: {
    message: {
      ...base,
      content: "Two good reads: https://featherston.co.nz and https://en.wikipedia.org/wiki/Featherston,_New_Zealand",
    },
  },
};

export const WithMentionAndUrl: Story = {
  args: {
    message: {
      ...base,
      content: "@[Jane Smith](user-1) here's that link I mentioned: https://featherston.co.nz/roadmap",
    },
  },
};

/** Image attachment with preview visible — hover the image to reveal hide and delete controls. */
export const WithImageAttachment: Story = {
  args: { message: { ...base, content: "Snapped this at the market!", files: [imgFile] } },
};

/**
 * Image preview hidden — the image has been collapsed to a chip.
 * Clicking "Show image" should reveal it (requires a live backend in Storybook).
 */
export const WithImagePreviewHidden: Story = {
  args: { message: { ...base, content: "Here's the photo", files: [imgFileHidden] } },
};

/** Non-image file attachment — renders a chip with file icon and download link. */
export const WithFileAttachment: Story = {
  args: { message: { ...base, content: "Agenda attached below", files: [pdfFile] } },
};

/** Image and file together — typical multi-attachment message. */
export const WithMultipleAttachments: Story = {
  args: { message: { ...base, content: "Photo and agenda from today:", files: [imgFile, pdfFile] } },
};

/**
 * File-only message — no text content, just an image.
 * The app allows sending files without typing any text.
 */
export const FileOnlyMessage: Story = {
  args: { message: { ...base, content: "", files: [imgFile] } },
};

/**
 * Moderator viewing someone else's attachment — moderator gets the delete
 * button even though they did not post the message.
 */
export const ModeratorWithAttachment: Story = {
  args: {
    currentUserId: "user-2",
    canModerate: true,
    message: { ...base, user_id: "user-1", content: "Here's the photo:", files: [imgFile] },
  },
};

function hoursAgo(n: number) {
  return new Date(Date.now() - n * 3_600_000).toISOString();
}

function daysAgo(n: number) {
  return new Date(Date.now() - n * 86_400_000).toISOString();
}

export const TwoHoursOld: Story = {
  args: { message: { ...base, created_at: hoursAgo(2) } },
};

export const ThreeDaysOld: Story = {
  args: { message: { ...base, created_at: daysAgo(3) } },
};

export const TwoWeeksOld: Story = {
  args: { message: { ...base, created_at: daysAgo(14) } },
};

export const ThreeMonthsOld: Story = {
  args: { message: { ...base, created_at: daysAgo(90) } },
};

export const TwoYearsOld: Story = {
  args: { message: { ...base, created_at: daysAgo(730) } },
};

// ── Behaviour tests (play functions) ─────────────────────────────────────────
// Pin the interactive contract of a message: what renders and which callbacks
// fire on which action. This is the behaviour that must survive the migration.

/** Author name and message text render. */
export const RendersAuthorAndText: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByText("Jane Smith")).toBeInTheDocument();
    await expect(canvas.getByText(/what's the plan for the weekend market/)).toBeInTheDocument();
  },
};

/** A deleted message shows a tombstone and hides the author. */
export const DeletedShowsTombstone: Story = {
  args: { message: { ...base, deleted_at: new Date().toISOString(), content: "" } },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByText("This message was deleted")).toBeInTheDocument();
    await expect(canvas.queryByText("Jane Smith")).not.toBeInTheDocument();
  },
};

/** An @mention renders as a pill showing the display name, never the user id. */
export const MentionRendersAsPill: Story = {
  args: { message: { ...base, content: "cheers @[Aroha Tane](user-9)" } },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByText("@Aroha Tane")).toBeInTheDocument();
    await expect(canvas.queryByText(/user-9/)).not.toBeInTheDocument();
  },
};

/** Reply link (singular) opens the thread via onOpenReplies. */
export const ReplyLinkOpensThread: Story = {
  args: { message: { ...base, reply_count: 1 } },
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByText("1 reply"));
    await expect(args.onOpenReplies).toHaveBeenCalled();
  },
};

/** Reply link pluralises for more than one reply. */
export const ReplyLinkPluralises: Story = {
  args: { message: { ...base, reply_count: 4 } },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByText("4 replies")).toBeInTheDocument();
  },
};

/** Clicking a reaction you made removes it (onUnreact); a new one adds it (onReact). */
export const ReactionToggles: Story = {
  args: {
    reactions: [
      { emoji: "👍", count: "3", user_ids: ["user-1", "user-2", "user-3"], user_names: ["Jane", "Mike", "Aroha"] },
      { emoji: "❤️", count: "1", user_ids: ["user-2"], user_names: ["Mike"] },
    ],
  },
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByRole("button", { name: /👍/ }));
    await expect(args.onUnreact).toHaveBeenCalledWith("m1", "👍");
    await userEvent.click(canvas.getByRole("button", { name: /❤️/ }));
    await expect(args.onReact).toHaveBeenCalledWith("m1", "❤️");
  },
};

/** The owner can edit: hover → Edit → change text → Save calls onEdit with the trimmed value. */
export const OwnerCanEdit: Story = {
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement);
    const msg = canvasElement.querySelector(".discussions-message") as HTMLElement;
    await userEvent.hover(msg);
    await userEvent.click(canvas.getByTitle("Edit"));
    const box = canvas.getByRole("textbox");
    await userEvent.clear(box);
    await userEvent.type(box, "Updated plan for Saturday");
    await userEvent.click(canvas.getByText("Save"));
    await expect(args.onEdit).toHaveBeenCalledWith("m1", "Updated plan for Saturday");
  },
};

/** The owner can delete: hover → Delete calls onDelete. */
export const OwnerCanDelete: Story = {
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement);
    const msg = canvasElement.querySelector(".discussions-message") as HTMLElement;
    await userEvent.hover(msg);
    await userEvent.click(canvas.getByTitle("Delete"));
    await expect(args.onDelete).toHaveBeenCalledWith("m1");
  },
};

/** A non-owner without moderation sees no edit or delete controls. */
export const NonOwnerHasNoEditOrDelete: Story = {
  args: { currentUserId: "user-2" },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const msg = canvasElement.querySelector(".discussions-message") as HTMLElement;
    await userEvent.hover(msg);
    await expect(canvas.queryByTitle("Edit")).not.toBeInTheDocument();
    await expect(canvas.queryByTitle("Delete")).not.toBeInTheDocument();
  },
};

/** A moderator viewing someone else's message can delete it but not edit it. */
export const ModeratorCanDeleteOthers: Story = {
  args: { currentUserId: "user-2", canModerate: true },
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement);
    const msg = canvasElement.querySelector(".discussions-message") as HTMLElement;
    await userEvent.hover(msg);
    await expect(canvas.queryByTitle("Edit")).not.toBeInTheDocument();
    await userEvent.click(canvas.getByTitle("Delete"));
    await expect(args.onDelete).toHaveBeenCalledWith("m1");
  },
};
