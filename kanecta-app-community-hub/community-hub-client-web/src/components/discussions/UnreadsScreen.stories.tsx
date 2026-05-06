import { useState } from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { MemoryRouter } from "react-router-dom";
import type { UnreadThread, Message } from "../../api/discussions";

// ── Fixtures ──────────────────────────────────────────────────────────────────

const now = Date.now();
const mins = (n: number) => new Date(now - n * 60_000).toISOString();
const days = (n: number) => new Date(now - n * 86_400_000).toISOString();

function msg(id: string, threadId: string, name: string, content: string, createdAt: string, replyCount = 0): Message {
  return {
    id, thread_id: threadId, parent_message_id: null,
    user_id: `u-${name.split(" ")[0].toLowerCase()}`,
    user_name: name, content,
    created_at: createdAt, edited_at: null, deleted_at: null,
    reply_count: replyCount,
  };
}

const UNREADS: UnreadThread[] = [
  {
    thread_id: "t1",
    name: "general",
    last_read_at: days(1),
    messages: [
      msg("m1", "t1", "Aroha Tane", "Morning everyone! Hope you all have a great day.", mins(90)),
      msg("m2", "t1", "Mike Robinson", "Anyone know if the library is open today?", mins(60)),
      msg("m3", "t1", "Sarah King", "Yes, opens at 10 I think.", mins(45), 2),
    ],
  },
  {
    thread_id: "t2",
    name: "community-ai",
    last_read_at: days(2),
    messages: [
      msg("m4", "t2", "Peter Cartledge", "Has anyone tried the new AI tools for community planning?", days(1)),
      msg("m5", "t2", "Emma McDougall", "Yes! Used it for the resilience plan draft — very helpful.", days(1)),
    ],
  },
];

// ── Shared mock helpers ───────────────────────────────────────────────────────

function avatar(name: string) {
  return name.split(" ").map((n: string) => n[0]).join("").slice(0, 2).toUpperCase();
}

function fmtTime(iso: string) {
  return new Date(iso).toLocaleTimeString("en-NZ", { hour: "numeric", minute: "2-digit" });
}

function MockMessage({ msg: m }: { msg: Message }) {
  return (
    <div className="unreads-screen__message">
      <div className="unreads-screen__message-avatar">{avatar(m.user_name)}</div>
      <div className="unreads-screen__message-body">
        <div className="unreads-screen__message-meta">
          <span className="unreads-screen__message-author">{m.user_name}</span>
          <span className="unreads-screen__message-time">{fmtTime(m.created_at)}</span>
        </div>
        <p className="unreads-screen__message-text">{m.content}</p>
        {m.reply_count > 0 && (
          <span className="unreads-screen__message-replies">{m.reply_count} replies</span>
        )}
      </div>
    </div>
  );
}

function MockUnreadsScreen({ initialUnreads }: { initialUnreads: UnreadThread[] }) {
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
          <button className="dm-bar__action unreads-screen__mark-all" onClick={() => setUnreads([])}>
            All read
          </button>
        ) : (
          <span className="dm-bar__action" />
        )}
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
                  <span className="unreads-screen__thread-hash">#</span>
                  {u.name}
                </button>
                <button
                  className="unreads-screen__thread-mark-read"
                  onClick={() => setUnreads((prev) => prev.filter((x) => x.thread_id !== u.thread_id))}
                >
                  Mark as Read
                </button>
              </div>
              <div className="unreads-screen__thread-messages">
                <div className="unreads-screen__date-divider"><span>Today</span></div>
                {u.messages.map((m) => <MockMessage key={m.id} msg={m} />)}
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
  title: "Discussions/Mobile/UnreadsScreen",
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

/**
 * Multiple unread threads. Tap "Mark as Read" to clear a thread — it disappears
 * from the list. Tap "All read" to clear everything and show the empty state.
 */
export const WithUnreads: Story = {
  render: () => <MockUnreadsScreen initialUnreads={UNREADS} />,
  name: "With unreads — tap Mark as Read to clear",
};

/** Single unread thread — the most common case day-to-day. */
export const SingleThread: Story = {
  render: () => <MockUnreadsScreen initialUnreads={[UNREADS[0]]} />,
  name: "Single unread thread",
};

/** All caught up — shown after all threads are marked read or when there are none. */
export const AllCaughtUp: Story = {
  render: () => <MockUnreadsScreen initialUnreads={[]} />,
  name: "All caught up — empty state",
};
