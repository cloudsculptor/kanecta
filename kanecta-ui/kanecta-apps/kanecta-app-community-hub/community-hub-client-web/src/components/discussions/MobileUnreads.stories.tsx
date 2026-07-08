import { useState } from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { MemoryRouter } from "react-router-dom";
import { within, userEvent, expect } from "storybook/test";
import type { UnreadThread, Message } from "../../api/discussions";

// ── Fixtures ──────────────────────────────────────────────────────────────────

const now = Date.now();
const mins = (n: number) => new Date(now - n * 60_000).toISOString();
const days = (n: number) => new Date(now - n * 86_400_000).toISOString();

function msg(id: string, threadId: string, name: string, content: string, createdAt: string, replyCount = 0, parentId: string | null = null): Message {
  return {
    id, thread_id: threadId, parent_message_id: parentId,
    user_id: `u-${name.split(" ")[0].toLowerCase()}`,
    user_name: name, content,
    created_at: createdAt, edited_at: null, deleted_at: null,
    reply_count: replyCount, files: [],
  };
}

const UNREADS_TOP_LEVEL: UnreadThread[] = [
  {
    thread_id: "t1",
    name: "general",
    last_read_at: days(1),
    messages: [
      msg("m1", "t1", "Aroha Tane", "Morning everyone! Hope you all have a great day.", mins(90)),
      msg("m2", "t1", "Mike Robinson", "Anyone know if the library is open today?", mins(60)),
    ],
  },
];

const UNREADS_REPLIES_ONLY: UnreadThread[] = [
  {
    thread_id: "t2",
    name: "general",
    last_read_at: mins(30),
    messages: [
      msg("p1", "t2", "Richard Thomas", "Off to the lake? Was beautiful this morning 🌄", days(1), 3),
      msg("r1", "t2", "Aroha Tane", "So gorgeous! Did you swim?", mins(20), 0, "p1"),
      msg("r2", "t2", "Mike Robinson", "Beautiful day for it 🏊", mins(10), 0, "p1"),
    ],
  },
];

// ── Mock helpers ──────────────────────────────────────────────────────────────

function avatar(name: string) {
  return name.split(" ").map((n: string) => n[0]).join("").slice(0, 2).toUpperCase();
}

function fmtTime(iso: string) {
  return new Date(iso).toLocaleTimeString("en-NZ", { hour: "numeric", minute: "2-digit" });
}

interface MessageGroup { parent: Message; isContext: boolean; replies: Message[]; }

function buildGroups(messages: Message[], lastReadAt: string): MessageGroup[] {
  const topLevel = messages.filter((m) => !m.parent_message_id);
  const replies = messages.filter((m) => m.parent_message_id);
  return topLevel
    .map((parent) => ({
      parent,
      isContext: parent.created_at <= lastReadAt,
      replies: replies.filter((r) => r.parent_message_id === parent.id),
    }))
    .filter((g) => !g.isContext || g.replies.length > 0);
}

function MockMsg({ message, muted = false }: { message: Message; muted?: boolean }) {
  return (
    <div className={`unreads-screen__message${muted ? " unreads-screen__message--context" : ""}`}>
      <div className="unreads-screen__message-avatar">{avatar(message.user_name)}</div>
      <div className="unreads-screen__message-body">
        <div className="unreads-screen__message-meta">
          <span className="unreads-screen__message-author">{message.user_name}</span>
          <span className="unreads-screen__message-time">{fmtTime(message.created_at)}</span>
          {muted && <span className="unreads-screen__context-label">original message</span>}
        </div>
        <p className="unreads-screen__message-text">{message.content}</p>
      </div>
    </div>
  );
}

function MockMobileUnreads({ initialUnreads }: { initialUnreads: UnreadThread[] }) {
  const [unreads, setUnreads] = useState<UnreadThread[]>(initialUnreads);
  return (
    <div className="unreads-screen dm-screen">
      <div className="dm-bar">
        <button className="dm-bar__back">
          <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <line x1="19" y1="12" x2="5" y2="12" /><polyline points="12 19 5 12 12 5" />
          </svg>
        </button>
        <span className="dm-bar__title">All Unreads</span>
        {unreads.length > 0 ? (
          <button className="dm-bar__action unreads-screen__mark-all" onClick={() => setUnreads([])}>All read</button>
        ) : <span className="dm-bar__action" />}
      </div>
      {unreads.length === 0 ? (
        <div className="unreads-screen__empty">
          <div className="unreads-screen__empty-icon">✓</div>
          You're all caught up!
        </div>
      ) : (
        <div className="unreads-screen__content">
          {unreads.map((u) => (
            <div key={u.thread_id} className="unreads-screen__thread">
              <div className="unreads-screen__thread-header">
                <button className="unreads-screen__thread-name">
                  <span className="unreads-screen__thread-hash">#</span>{u.name}
                </button>
                <button
                  className="unreads-screen__thread-mark-read"
                  onClick={() => setUnreads((prev) => prev.filter((x) => x.thread_id !== u.thread_id))}
                >
                  Mark as Read
                </button>
              </div>
              <div className="unreads-screen__thread-messages">
                {buildGroups(u.messages, u.last_read_at).map((g) => (
                  <div key={g.parent.id} className="unreads-screen__group">
                    <MockMsg message={g.parent} muted={g.isContext} />
                    {g.replies.length > 0 && (
                      <div className="unreads-screen__group-replies">
                        {g.replies.map((r) => <MockMsg key={r.id} message={r} />)}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Meta ──────────────────────────────────────────────────────────────────────

const meta: Meta = {
  title: "Discussions/Mobile/MobileUnreads",
  decorators: [
    (Story) => (
      <MemoryRouter>
        <div style={{ width: 390, height: 700, border: "12px solid #222", borderRadius: 40, overflow: "hidden", boxShadow: "0 20px 60px rgba(0,0,0,0.3)", background: "#fff" }}>
          <Story />
        </div>
      </MemoryRouter>
    ),
  ],
  parameters: { viewport: { defaultViewport: "mobile2" } },
};
export default meta;
type Story = StoryObj;

/** New top-level messages — tap Mark as Read to clear. */
export const NewTopLevelMessages: Story = {
  render: () => <MockMobileUnreads initialUnreads={UNREADS_TOP_LEVEL} />,
  name: "New top-level messages",
};

/** Only new replies — parent shown muted as context, replies indented below. */
export const NewRepliesOnly: Story = {
  render: () => <MockMobileUnreads initialUnreads={UNREADS_REPLIES_ONLY} />,
  name: "New replies only — parent as context",
};

/** All caught up. */
export const AllCaughtUp: Story = {
  render: () => <MockMobileUnreads initialUnreads={[]} />,
  name: "All caught up — empty state",
};

// ── Behaviour tests (play functions) ─────────────────────────────────────────
// The real MobileUnreads populates itself from api.reads.list() (a live network
// call with no injectable prop for the data), so its unread content can't be
// rendered without a backend. These stories drive the network-free MockMobileUnreads
// harness above — which mirrors the real component's markup and mark-read logic —
// to pin the rendered contract and the tap-to-mark-read interaction.

/** New top-level messages render their authors, text, and per-thread "Mark as Read". */
export const RendersUnreadMessages: Story = {
  render: () => <MockMobileUnreads initialUnreads={UNREADS_TOP_LEVEL} />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByText("All Unreads")).toBeInTheDocument();
    await expect(canvas.getByText("Aroha Tane")).toBeInTheDocument();
    await expect(canvas.getByText("Morning everyone! Hope you all have a great day.")).toBeInTheDocument();
    await expect(canvas.getByText("Mike Robinson")).toBeInTheDocument();
    await expect(canvas.getByText("Mark as Read")).toBeInTheDocument();
  },
  name: "Renders unread messages",
};

/** Tapping "Mark as Read" clears that thread; with none left the empty state shows. */
export const MarkAsReadClearsThread: Story = {
  render: () => <MockMobileUnreads initialUnreads={UNREADS_TOP_LEVEL} />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByText("Mark as Read"));
    await expect(canvas.getByText("You're all caught up!")).toBeInTheDocument();
    await expect(canvas.queryByText("Mark as Read")).not.toBeInTheDocument();
  },
  name: "Mark as Read clears the thread",
};

/** Replies-only thread: the parent shows muted as "original message" context above its replies. */
export const RepliesShownWithContext: Story = {
  render: () => <MockMobileUnreads initialUnreads={UNREADS_REPLIES_ONLY} />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByText("original message")).toBeInTheDocument();
    await expect(canvas.getByText("Richard Thomas")).toBeInTheDocument();
    await expect(canvas.getByText("So gorgeous! Did you swim?")).toBeInTheDocument();
  },
  name: "Replies shown with parent context",
};

/** Empty state renders the caught-up message and no thread controls. */
export const EmptyStateRenders: Story = {
  render: () => <MockMobileUnreads initialUnreads={[]} />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByText("You're all caught up!")).toBeInTheDocument();
    await expect(canvas.queryByText("Mark as Read")).not.toBeInTheDocument();
  },
  name: "Empty state renders",
};
