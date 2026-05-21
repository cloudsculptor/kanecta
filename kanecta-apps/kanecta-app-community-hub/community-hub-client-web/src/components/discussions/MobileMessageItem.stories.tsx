import type { Meta, StoryObj } from "@storybook/react-vite";
import { MemoryRouter } from "react-router-dom";
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
    return (
      <MemoryRouter>
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
      </MemoryRouter>
    );
  },
  args: { currentUserId: "user-1" },
  name: "Action sheet (long press) — static preview",
};
