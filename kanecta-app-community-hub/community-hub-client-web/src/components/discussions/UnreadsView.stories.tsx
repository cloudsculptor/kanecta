import { useState } from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { MemoryRouter } from "react-router-dom";
import type { UnreadThread, Message } from "../../api/discussions";

// ── Fixtures ──────────────────────────────────────────────────────────────────

const now = Date.now();
const mins = (n: number) => new Date(now - n * 60_000).toISOString();
const days = (n: number) => new Date(now - n * 86_400_000).toISOString();

function msg(id: string, threadId: string, name: string, content: string, createdAt: string, replyCount = 0) {
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

const SINGLE_UNREAD: UnreadThread[] = [
  {
    thread_id: "t3",
    name: "proposed-features",
    last_read_at: days(3),
    messages: [
      msg("m6", "t3", "Richard Thomas", "Can we add a calendar view for events?", mins(30)),
    ],
  },
];

function avatar(name: string) {
  return name.split(" ").map((n: string) => n[0]).join("").slice(0, 2).toUpperCase();
}

function fmtTime(iso: string) {
  return new Date(iso).toLocaleTimeString("en-NZ", { hour: "numeric", minute: "2-digit" });
}

function MockMessage({ msg }: { msg: Message }) {
  return (
    <div className="unreads-message">
      <div className="unreads-message__avatar">{avatar(msg.user_name)}</div>
      <div className="unreads-message__body">
        <div className="unreads-message__meta">
          <span className="unreads-message__author">{msg.user_name}</span>
          <span className="unreads-message__time">{fmtTime(msg.created_at)}</span>
        </div>
        <p className="unreads-message__text">{msg.content}</p>
        {msg.reply_count > 0 && (
          <span className="unreads-message__replies">{msg.reply_count} replies</span>
        )}
      </div>
    </div>
  );
}

// ── Meta ──────────────────────────────────────────────────────────────────────

const meta: Meta = {
  title: "Discussions/UnreadsView",
  decorators: [
    (Story) => (
      <MemoryRouter>
        <div style={{ display: "flex", height: "100vh", overflow: "hidden" }}>
          {/* Sidebar stub */}
          <aside className="discussions-sidebar" style={{ width: 220 }}>
            <button className="discussions-nav-item discussions-nav-item--active">
              <svg className="discussions-nav-item__icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z" />
                <line x1="9" y1="10" x2="15" y2="10" />
                <line x1="9" y1="14" x2="13" y2="14" />
              </svg>
              All Unreads
              <span className="discussions-nav-item__badge">3</span>
            </button>
            <div className="discussions-sidebar__heading">
              Threads
              <button className="discussions-sidebar__new">+</button>
            </div>
            <ul className="discussions-sidebar__list">
              {[
                { id: "t1", name: "general", has_unread: true },
                { id: "t2", name: "community-ai", has_unread: true },
                { id: "t3", name: "proposed-features", has_unread: true },
                { id: "t4", name: "events", has_unread: false },
              ].map((t) => (
                <li key={t.id}>
                  <button className={`discussions-thread-item${t.has_unread ? " discussions-thread-item--unread" : ""}`}>
                    <span className="discussions-thread-item__hash">#</span>
                    <span className="discussions-thread-item__content">
                      <span className="discussions-thread-item__name">{t.name}</span>
                    </span>
                    {t.has_unread && <span className="discussions-thread-item__dot" />}
                  </button>
                </li>
              ))}
            </ul>
          </aside>

          {/* Main panel */}
          <main className="discussions-main discussions-main--unreads" style={{ flex: 1 }}>
            <Story />
          </main>
        </div>
      </MemoryRouter>
    ),
  ],
};
export default meta;
type Story = StoryObj;

/**
 * Multiple threads with unreads. Each thread shows its heading, a Mark as Read
 * button, a date divider, and the unread messages below.
 */
function WithUnreadsDemo() {
  const [unreads, setUnreads] = useState<UnreadThread[]>(UNREADS);
  return (
    <div className="unreads-view" style={{ flex: 1, overflowY: "auto" }}>
      <div className="unreads-view__header">
        <h1 className="unreads-view__title">All Unreads</h1>
        <button className="unreads-view__mark-all" onClick={() => setUnreads([])}>Mark all as read</button>
      </div>
      {unreads.map((u) => (
        <div key={u.thread_id} className="unreads-thread">
          <div className="unreads-thread__header">
            <button className="unreads-thread__name">
              <span className="unreads-thread__hash">#</span>{u.name}
            </button>
            <button
              className="unreads-thread__mark-read"
              onClick={() => setUnreads((prev) => prev.filter((x) => x.thread_id !== u.thread_id))}
            >
              Mark as Read
            </button>
          </div>
          <div className="unreads-thread__messages">
            <div className="unreads-thread__date-divider"><span>Today</span></div>
            {u.messages.map((msg) => <MockMessage key={msg.id} msg={msg} />)}
          </div>
        </div>
      ))}
      {unreads.length === 0 && (
        <div className="unreads-view__empty">
          <div className="unreads-view__empty-icon">✓</div>
          You're all caught up!
        </div>
      )}
    </div>
  );
}

export const WithUnreads: Story = {
  render: () => <WithUnreadsDemo />,
  name: "With unreads — multiple threads (Mark as Read clears each)",
};

/**
 * Single unread thread — the common case just after checking in.
 */
export const SingleThread: Story = {
  render: () => (
    <div className="unreads-view" style={{ flex: 1, overflowY: "auto" }}>
      <div className="unreads-view__header">
        <h1 className="unreads-view__title">All Unreads</h1>
      </div>
      {SINGLE_UNREAD.map((u) => (
        <div key={u.thread_id} className="unreads-thread">
          <div className="unreads-thread__header">
            <button className="unreads-thread__name">
              <span className="unreads-thread__hash">#</span>{u.name}
            </button>
            <button className="unreads-thread__mark-read">Mark as Read</button>
          </div>
          <div className="unreads-thread__messages">
            <div className="unreads-thread__date-divider"><span>Today</span></div>
            {u.messages.map((msg) => <MockMessage key={msg.id} msg={msg} />)}
          </div>
        </div>
      ))}
    </div>
  ),
  name: "Single unread thread",
};

/** All caught up — no unread threads. */
export const AllCaughtUp: Story = {
  render: () => (
    <div className="unreads-view" style={{ flex: 1, display: "flex", flexDirection: "column" }}>
      <div className="unreads-view__header">
        <h1 className="unreads-view__title">All Unreads</h1>
      </div>
      <div className="unreads-view__empty">
        <div className="unreads-view__empty-icon">✓</div>
        You're all caught up!
      </div>
    </div>
  ),
  name: "All caught up — empty state",
};
