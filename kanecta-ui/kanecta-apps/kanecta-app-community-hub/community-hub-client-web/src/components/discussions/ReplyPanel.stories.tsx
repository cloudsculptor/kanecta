import { useState } from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { within, userEvent, expect } from "storybook/test";
import MessageItem from "./MessageItem";
import MentionInput from "./MentionInput";
import type { Message, Reaction } from "../../api/discussions";

// ── Shared data ───────────────────────────────────────────────────────────────

const PLACEHOLDER_IMAGE = "data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSIzMjAiIGhlaWdodD0iMjAwIj48cmVjdCB3aWR0aD0iMzIwIiBoZWlnaHQ9IjIwMCIgZmlsbD0iIzNhN2Q0NCIvPjwvc3ZnPg==";

const parentMessage: Message = {
  id: "m1", thread_id: "t1", parent_message_id: null,
  user_id: "user-1", user_name: "Jane Smith",
  content: "What's the plan for the weekend market?",
  created_at: new Date().toISOString(), edited_at: null, deleted_at: null, reply_count: 2,
  files: [],
};

const replies: Message[] = [
  {
    id: "r1", thread_id: "t1", parent_message_id: "m1",
    user_id: "user-2", user_name: "Mike Robinson",
    content: "I can bring the trestle tables.",
    created_at: new Date().toISOString(), edited_at: null, deleted_at: null, reply_count: 0,
    files: [],
  },
  {
    id: "r2", thread_id: "t1", parent_message_id: "m1",
    user_id: "user-3", user_name: "Aroha Tane",
    content: "Happy to help with setup from 8am.",
    created_at: new Date().toISOString(), edited_at: null, deleted_at: null, reply_count: 0,
    files: [],
  },
];

const repliesWithAttachment: Message[] = [
  {
    ...replies[0],
    id: "ra1",
    content: "Here's a photo of the tables:",
    files: [{ id: "mf1", file_id: "f1", name: "tables.jpg", mime_type: "image/jpeg", size_bytes: 95_000, url: PLACEHOLDER_IMAGE, show_preview: true }],
  },
  {
    ...replies[1],
    id: "ra2",
    files: [],
  },
];

const seedReactions: Record<string, Reaction[]> = {
  m1: [
    { emoji: "👍", count: "3", user_ids: ["user-1", "user-2", "user-3"], user_names: ["Jane Smith", "Mike Robinson", "Aroha Tane"] },
    { emoji: "❤️", count: "1", user_ids: ["user-2"], user_names: ["Mike Robinson"] },
  ],
  r1: [
    { emoji: "🙌", count: "2", user_ids: ["user-1", "user-3"], user_names: ["Jane Smith", "Aroha Tane"] },
  ],
};

// ── Panel wrapper (no API calls — data seeded directly) ───────────────────────

function ReplyPanelDemo({
  initialReactions = {},
  initialReplies = replies,
  currentUserId = "user-1",
  canModerate = false,
}: {
  initialReactions?: Record<string, Reaction[]>;
  initialReplies?: Message[];
  currentUserId?: string;
  canModerate?: boolean;
}) {
  const [reactions, setReactions] = useState<Record<string, Reaction[]>>(initialReactions);
  const noop = async () => {};

  async function handleReact(id: string, emoji: string) {
    setReactions((prev) => {
      const existing = prev[id] ?? [];
      const hit = existing.find((r) => r.emoji === emoji);
      if (hit) {
        return { ...prev, [id]: existing.map((r) => r.emoji === emoji ? { ...r, count: String(Number(r.count) + 1), user_ids: [...r.user_ids, currentUserId], user_names: [...r.user_names, "You"] } : r) };
      }
      return { ...prev, [id]: [...existing, { emoji, count: "1", user_ids: [currentUserId], user_names: ["You"] }] };
    });
  }

  async function handleUnreact(id: string, emoji: string) {
    setReactions((prev) => {
      const updated = (prev[id] ?? []).map((r) => r.emoji === emoji ? { ...r, count: String(Number(r.count) - 1), user_ids: r.user_ids.filter((u) => u !== currentUserId), user_names: r.user_names.filter((_, i) => r.user_ids[i] !== currentUserId) } : r).filter((r) => Number(r.count) > 0);
      return { ...prev, [id]: updated };
    });
  }

  return (
    <div className="discussions-reply-panel">
      <div className="discussions-reply-panel__header">
        <button className="discussions-reply-panel__back" aria-label="Back">
          <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="15 18 9 12 15 6" />
          </svg>
          <span className="discussions-reply-panel__back-label">Back</span>
        </button>
        <span>Thread</span>
        <button className="discussions-reply-panel__close" aria-label="Close thread">×</button>
      </div>

      <div className="discussions-reply-panel__original">
        <MessageItem
          message={parentMessage}
          reactions={reactions[parentMessage.id] ?? []}
          currentUserId={currentUserId}
          canModerate={canModerate}
          onEdit={noop}
          onDelete={noop}
          onReact={handleReact}
          onUnreact={handleUnreact}
          onOpenReplies={() => {}}
        />
      </div>

      <div className="discussions-reply-panel__replies">
        {initialReplies.map((r) => (
          <MessageItem
            key={r.id}
            message={r}
            reactions={reactions[r.id] ?? []}
            currentUserId={currentUserId}
            canModerate={canModerate}
            onEdit={noop}
            onDelete={noop}
            onReact={handleReact}
            onUnreact={handleUnreact}
            onOpenReplies={() => {}}
          />
        ))}
      </div>

      <div className="discussions-reply-panel__input">
        <MentionInput placeholder="Reply…" onSend={async () => {}} users={[]} />
      </div>
    </div>
  );
}

// ── Stories ───────────────────────────────────────────────────────────────────

const meta: Meta<typeof ReplyPanelDemo> = {
  title: "Discussions/ReplyPanel",
  component: ReplyPanelDemo,
  decorators: [(Story) => (
    <div style={{ display: "flex", height: "600px", border: "1px solid #eee" }}>
      <div style={{ flex: 1, background: "#f9f9f9" }} />
      <Story />
    </div>
  )],
  args: {
    currentUserId: "user-1",
    canModerate: false,
  },
};
export default meta;
type Story = StoryObj<typeof ReplyPanelDemo>;

/** Panel loaded with no reactions — matches the state before any emoji is added. */
export const Default: Story = {};

/**
 * Reactions on both the parent message and replies, as they appear after a
 * browser refresh. Verifies that reactions loaded from the API are rendered
 * correctly — the bug this tests was reactions disappearing on refresh.
 */
export const WithReactions: Story = {
  args: { initialReactions: seedReactions },
};

/** Moderator sees delete controls on all messages. */
export const ModeratorView: Story = {
  args: { currentUserId: "user-2", canModerate: true, initialReactions: seedReactions },
};

/** A reply contains an image attachment — verifies the image renders inside a thread panel. */
export const ReplyWithAttachment: Story = {
  args: { initialReplies: repliesWithAttachment },
};

// ── Behaviour tests (play functions) ─────────────────────────────────────────
// Pin the thread panel's rendered contract: the parent message, its replies,
// the header controls, the reply composer, and reaction toggling.

/** The parent message and every reply render their text. */
export const RendersParentAndReplies: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByText("What's the plan for the weekend market?")).toBeInTheDocument();
    await expect(canvas.getByText("I can bring the trestle tables.")).toBeInTheDocument();
    await expect(canvas.getByText("Happy to help with setup from 8am.")).toBeInTheDocument();
  },
};

/** Header shows the "Thread" label plus Back and Close controls, and the reply composer is present. */
export const RendersHeaderAndComposer: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByText("Thread")).toBeInTheDocument();
    // Query by aria-label directly — these buttons wrap an SVG, which can
    // disturb accessible-name computation for a role+name query.
    await expect(canvas.getByLabelText("Back")).toBeInTheDocument();
    await expect(canvas.getByLabelText("Close thread")).toBeInTheDocument();
    await expect(canvas.getByPlaceholderText("Reply…")).toBeInTheDocument();
    await expect(canvas.getByRole("button", { name: "Send message" })).toBeInTheDocument();
  },
};

/** With no replies seeded, only the parent renders — no reply bodies appear. */
export const EmptyRepliesShowsOnlyParent: Story = {
  args: { initialReplies: [] },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByText("What's the plan for the weekend market?")).toBeInTheDocument();
    await expect(canvas.queryByText("I can bring the trestle tables.")).not.toBeInTheDocument();
  },
};

/** Reactions seeded on the parent and a reply render with their emoji and count. */
export const ReactionsRenderFromProps: Story = {
  args: { initialReactions: seedReactions },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByRole("button", { name: "👍 3" })).toBeInTheDocument();
    await expect(canvas.getByRole("button", { name: "❤️ 1" })).toBeInTheDocument();
    await expect(canvas.getByRole("button", { name: "🙌 2" })).toBeInTheDocument();
  },
};

/** Clicking a reaction the current user already made removes their vote — the count drops by one. */
export const OwnReactionUnreactsAndDecrements: Story = {
  args: { initialReactions: seedReactions },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByRole("button", { name: "👍 3" }));
    await expect(canvas.getByRole("button", { name: "👍 2" })).toBeInTheDocument();
  },
};

/** Clicking a reaction the current user has not made adds their vote — the count rises by one. */
export const NewReactionReactsAndIncrements: Story = {
  args: { initialReactions: seedReactions },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    // currentUser (user-1) is not in the ❤️ voters, so clicking adds a vote.
    await userEvent.click(canvas.getByRole("button", { name: "❤️ 1" }));
    await expect(canvas.getByRole("button", { name: "❤️ 2" })).toBeInTheDocument();
  },
};

/** A moderator hovering a reply gets a Delete control on that message. */
export const ModeratorSeesDeleteOnHover: Story = {
  args: { currentUserId: "user-2", canModerate: true },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const reply = canvas.getByText("Happy to help with setup from 8am.").closest(".discussions-message") as HTMLElement;
    await userEvent.hover(reply);
    await expect(within(reply).getByTitle("Delete")).toBeInTheDocument();
  },
};
