import type { Meta, StoryObj } from "@storybook/react-vite";
import { MemoryRouter } from "react-router-dom";
import { within, userEvent, expect, fn } from "storybook/test";
import MobileMessageItem from "./MobileMessageItem";
import type { MessageFile, Reaction } from "../../api/discussions";

const PLACEHOLDER_IMAGE = "data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSIzMjAiIGhlaWdodD0iMjAwIj48cmVjdCB3aWR0aD0iMzIwIiBoZWlnaHQ9IjIwMCIgZmlsbD0iIzNhN2Q0NCIvPjwvc3ZnPg==";

const imgFile: MessageFile = {
  id: "mf1", file_id: "f1", name: "market-photo.jpg", mime_type: "image/jpeg",
  size_bytes: 142_000, url: PLACEHOLDER_IMAGE, show_preview: true,
};

const imgHidden: MessageFile = { ...imgFile, id: "mf2", show_preview: false };

const pdfFile: MessageFile = {
  id: "mf3", file_id: "f3", name: "weekend-agenda.pdf", mime_type: "application/pdf",
  size_bytes: 82_500, url: "#", show_preview: true,
};

const base = {
  id: "m1", thread_id: "t1", parent_message_id: null,
  user_id: "user-1", user_name: "Aroha Tane",
  content: "Hey everyone, what's the plan for Saturday?",
  created_at: new Date().toISOString(), edited_at: null, deleted_at: null,
  reply_count: 0, files: [] as MessageFile[],
};

const reactions: Reaction[] = [
  { emoji: "👍", count: "3", user_ids: ["user-1", "user-2", "user-3"], user_names: ["Aroha", "Mike", "Sarah"] },
  { emoji: "❤️", count: "1", user_ids: ["user-2"], user_names: ["Mike R."] },
];

const noop = async () => {};

const meta: Meta<typeof MobileMessageItem> = {
  title: "Discussions/MobileMessageItem",
  component: MobileMessageItem,
  decorators: [
    (Story) => (
      <MemoryRouter>
        <div style={{ padding: 16, maxWidth: 390, background: "#fff" }}>
          <Story />
        </div>
      </MemoryRouter>
    ),
  ],
  parameters: { viewport: { defaultViewport: "mobile2" } },
  args: {
    message: base, reactions: [], currentUserId: "user-1",
    canModerate: false, onEdit: noop, onDelete: noop,
    onReact: noop, onUnreact: noop, onOpenReplies: noop,
  },
};
export default meta;
type Story = StoryObj<typeof MobileMessageItem>;

export const Default: Story = {};

export const OtherUser: Story = {
  args: { currentUserId: "user-2" },
};

export const Edited: Story = {
  args: { message: { ...base, edited_at: new Date().toISOString() } },
};

export const Deleted: Story = {
  args: { message: { ...base, deleted_at: new Date().toISOString(), content: "" } },
};

export const WithReactions: Story = {
  args: { reactions },
};

/** Reply count shown — tapping it opens the thread. */
export const WithReplies: Story = {
  args: { message: { ...base, reply_count: 4 } },
};

/** Image attachment with preview visible. */
export const WithImageAttachment: Story = {
  args: { message: { ...base, content: "Check out the market!", files: [imgFile] } },
};

/** Image preview collapsed — shows chip with Show image button. */
export const WithImageHidden: Story = {
  args: { message: { ...base, content: "Photo below", files: [imgHidden] } },
};

/** Non-image file attachment — PDF chip with download. */
export const WithFileAttachment: Story = {
  args: { message: { ...base, content: "Agenda attached", files: [pdfFile] } },
};

/** File-only message — no text, just an image. */
export const FileOnlyMessage: Story = {
  args: { message: { ...base, content: "", files: [imgFile] } },
};

/** Image and file together. */
export const WithMultipleAttachments: Story = {
  args: { message: { ...base, content: "Photo and agenda:", files: [imgFile, pdfFile] } },
};

/** Owner view — image has delete button. */
export const OwnerWithAttachment: Story = {
  args: {
    currentUserId: "user-1",
    message: { ...base, content: "My photo:", files: [imgFile] },
  },
};

/** Moderator viewing another user's attachment — gets delete button. */
export const ModeratorWithAttachment: Story = {
  args: {
    currentUserId: "user-2",
    canModerate: true,
    message: { ...base, user_id: "user-1", content: "Here's the photo:", files: [imgFile] },
  },
};

/** Long press reveals the action sheet — shown statically here in the open state. */
export const WithActionSheetOpen: Story = {
  render: (args) => {
    // No <MemoryRouter> here — the meta decorator already provides one; nesting
    // a second router throws "cannot render a Router inside another Router".
    return (
      <div style={{ padding: 16, maxWidth: 390, background: "#fff", position: "relative" }}>
        <MobileMessageItem {...args} />
        {/* Sheet rendered outside the component for static preview */}
        <div style={{ position: "fixed", inset: 0, pointerEvents: "none" }}>
          <div style={{ position: "absolute", inset: 0, background: "rgba(0,0,0,0.4)" }} />
          <div className="dm-msg-sheet" style={{ pointerEvents: "auto" }}>
            <div className="dm-msg-sheet__handle" />
            <div className="dm-msg-sheet__reactions">
              {["👍","❤️","😂","😮","😢","🙏"].map((e) => (
                <button key={e} className="dm-msg-sheet__emoji">{e}</button>
              ))}
            </div>
            <div className="dm-msg-sheet__divider" />
            <button className="dm-msg-sheet__action">Edit</button>
            <button className="dm-msg-sheet__action dm-msg-sheet__action--danger">Delete</button>
            <div className="dm-msg-sheet__divider" />
            <button className="dm-msg-sheet__action dm-msg-sheet__action--cancel">Cancel</button>
          </div>
        </div>
      </div>
    );
  },
  args: { currentUserId: "user-1" },
  name: "Action sheet (long press) — static preview",
};

// ── Behaviour tests (play functions) ─────────────────────────────────────────
// Pin the reliably-reachable interactive contract of the mobile message row.
// The action sheet (Edit/Delete/quick-react) is opened by a 500ms LONG-PRESS on a
// real touch device — that gesture (touch events + timer) can't be driven reliably
// with userEvent, so those paths are covered by the static-preview story above and
// intentionally NOT asserted here. Tap-to-open-replies, the reply link, reactions,
// and the render-only states (deleted/edited/mention) are all directly reachable.

/** Author name and message text render. */
export const RendersAuthorAndText: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByText("Aroha Tane")).toBeInTheDocument();
    await expect(canvas.getByText(/what's the plan for Saturday/)).toBeInTheDocument();
  },
};

/** Tapping the message body opens the thread via onOpenReplies (with the message). */
export const TapOpensReplies: Story = {
  args: { onOpenReplies: fn() },
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement);
    // Author name node bubbles the click to the row's onClick (not a stopPropagation zone).
    await userEvent.click(canvas.getByText("Aroha Tane"));
    await expect(args.onOpenReplies).toHaveBeenCalledWith(args.message);
  },
};

/** The reply link (pluralised) opens the thread via onOpenReplies. */
export const ReplyLinkOpensThread: Story = {
  args: { message: { ...base, reply_count: 4 }, onOpenReplies: fn() },
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByText("4 replies")).toBeInTheDocument();
    await userEvent.click(canvas.getByText("4 replies"));
    await expect(args.onOpenReplies).toHaveBeenCalled();
  },
};

/** A single reply is not pluralised. */
export const ReplyLinkSingular: Story = {
  args: { message: { ...base, reply_count: 1 } },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByText("1 reply")).toBeInTheDocument();
  },
};

/** Clicking a reaction you already made removes it (onUnreact); a new one adds it (onReact). */
export const ReactionToggles: Story = {
  args: { reactions, onReact: fn(), onUnreact: fn() },
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement);
    // 👍 includes user-1 (default currentUserId) → tapping removes it.
    await userEvent.click(canvas.getByRole("button", { name: /👍/ }));
    await expect(args.onUnreact).toHaveBeenCalledWith("m1", "👍");
    // ❤️ does not include user-1 → tapping adds it.
    await userEvent.click(canvas.getByRole("button", { name: /❤️/ }));
    await expect(args.onReact).toHaveBeenCalledWith("m1", "❤️");
  },
};

/** A deleted message shows a tombstone and hides the author. */
export const DeletedShowsTombstone: Story = {
  args: { message: { ...base, deleted_at: new Date().toISOString(), content: "" } },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByText("This message was deleted")).toBeInTheDocument();
    await expect(canvas.queryByText("Aroha Tane")).not.toBeInTheDocument();
  },
};

/** An edited message shows the "(edited)" marker. */
export const EditedShowsMarker: Story = {
  args: { message: { ...base, edited_at: new Date().toISOString() } },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByText("(edited)")).toBeInTheDocument();
  },
};

/** An @mention renders as a pill showing the display name, never the user id. */
export const MentionRendersAsPill: Story = {
  args: { message: { ...base, content: "cheers @[Mike Robinson](user-9)" } },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByText("@Mike Robinson")).toBeInTheDocument();
    await expect(canvas.queryByText(/user-9/)).not.toBeInTheDocument();
  },
};
