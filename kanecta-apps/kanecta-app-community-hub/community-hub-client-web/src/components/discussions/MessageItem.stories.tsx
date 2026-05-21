import type { Meta, StoryObj } from "@storybook/react-vite";
import { MemoryRouter } from "react-router-dom";
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

const noop = async () => {};

const meta: Meta<typeof MessageItem> = {
  title: "Discussions/MessageItem",
  component: MessageItem,
  decorators: [(Story) => <MemoryRouter><div style={{ padding: 20, maxWidth: 600 }}><Story /></div></MemoryRouter>],
  args: {
    message: base, reactions: [], currentUserId: "user-1",
    canModerate: false, onEdit: noop, onDelete: noop,
    onReact: noop, onUnreact: noop, onOpenReplies: noop,
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
