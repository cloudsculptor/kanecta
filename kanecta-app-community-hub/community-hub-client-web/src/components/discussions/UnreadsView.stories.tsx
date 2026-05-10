import { useState } from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { MemoryRouter } from "react-router-dom";
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
    reply_count: replyCount,
  };
}

// All new top-level messages
const UNREADS_TOP_LEVEL: UnreadThread[] = [
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
      msg("m4", "t2", "Peter Cartledge", "Has anyone tried the new AI tools?", days(1)),
      msg("m5", "t2", "Emma McDougall", "Yes! Very helpful for the resilience plan.", days(1)),
    ],
  },
];

// Only new replies — parent message is older than last_read_at (context message)
const UNREADS_REPLIES_ONLY: UnreadThread[] = [
  {
    thread_id: "t3",
    name: "general",
    last_read_at: mins(30),
    messages: [
      // Parent is old (context) — created_at < last_read_at
      msg("p1", "t3", "Richard Thomas", "Off to the lake? Was beautiful this morning 🌄", days(1), 3),
      // New replies
      msg("r1", "t3", "Aroha Tane", "So gorgeous! Did you swim?", mins(20), 0, "p1"),
      msg("r2", "t3", "Mike Robinson", "Beautiful day for it 🏊", mins(10), 0, "p1"),
    ],
  },
];

// Mix of new top-level messages and new replies on an older message
const UNREADS_MIXED: UnreadThread[] = [
  {
    thread_id: "t4",
    name: "general",
    last_read_at: mins(45),
    messages: [
      // Old parent (context) with new replies
      msg("p1", "t4", "Richard Thomas", "Anyone up for a working bee this weekend?", days(2), 3),
      msg("r1", "t4", "Aroha Tane", "I can help Saturday morning!", mins(40), 0, "p1"),
      msg("r2", "t4", "Sarah King", "Count me in too 👍", mins(35), 0, "p1"),
      // New top-level message
      msg("m1", "t4", "Peter Cartledge", "Great, I'll bring the tools.", mins(20)),
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
    <div className={`unreads-message${muted ? " unreads-message--context" : ""}`}>
      <div className="unreads-message__avatar">{avatar(message.user_name)}</div>
      <div className="unreads-message__body">
        <div className="unreads-message__meta">
          <span className="unreads-message__author">{message.user_name}</span>
          <span className="unreads-message__time">{fmtTime(message.created_at)}</span>
          {muted && <span className="unreads-message__context-label">original message</span>}
        </div>
        <p className="unreads-message__text">{message.content}</p>
        {!muted && message.reply_count > 0 && (
          <span className="unreads-message__replies">{message.reply_count} replies</span>
        )}
      </div>
    </div>
  );
}

function MockGroup({ group }: { group: MessageGroup }) {
  return (
    <div className="unreads-group">
      <MockMsg message={group.parent} muted={group.isContext} />
      {group.replies.length > 0 && (
        <div className="unreads-group__replies">
          {group.replies.map((r) => <MockMsg key={r.id} message={r} />)}
        </div>
      )}
    </div>
  );
}

function MockUnreadsView({ initialUnreads }: { initialUnreads: UnreadThread[] }) {
  const [unreads, setUnreads] = useState<UnreadThread[]>(initialUnreads);
  return (
    <div className="unreads-view" style={{ flex: 1, overflowY: "auto" }}>
      <div className="unreads-view__header">
        <h1 className="unreads-view__title">All Unreads</h1>
        {unreads.length > 0 && (
          <button className="unreads-view__mark-all" onClick={() => setUnreads([])}>Mark all as read</button>
        )}
      </div>
      {unreads.length === 0 ? (
        <div className="unreads-view__empty">
          <div className="unreads-view__empty-icon">✓</div>
          You're all caught up!
        </div>
      ) : (
        unreads.map((u) => (
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
              {buildGroups(u.messages, u.last_read_at).map((g) => (
                <MockGroup key={g.parent.id} group={g} />
              ))}
            </div>
          </div>
        ))
      )}
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
          <aside className="discussions-sidebar" style={{ width: 220 }}>
            <div className="discussions-sidebar__nav-section">
              <button className="discussions-nav-item discussions-nav-item--active">
                <svg className="discussions-nav-item__icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z" />
                  <line x1="9" y1="10" x2="15" y2="10" />
                  <line x1="9" y1="14" x2="13" y2="14" />
                </svg>
                All Unreads
                <span className="discussions-nav-item__badge">2</span>
              </button>
            </div>
            <div className="discussions-sidebar__heading">Threads</div>
            <ul className="discussions-sidebar__list">
              {["general", "community-ai", "events"].map((name) => (
                <li key={name}>
                  <button className={`discussions-thread-item${name === "general" ? " discussions-thread-item--unread" : ""}`}>
                    <span className="discussions-thread-item__hash">#</span>
                    <span className="discussions-thread-item__content">
                      <span className="discussions-thread-item__name">{name}</span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </aside>
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

/** New top-level messages across two threads. */
export const NewTopLevelMessages: Story = {
  render: () => <MockUnreadsView initialUnreads={UNREADS_TOP_LEVEL} />,
  name: "New top-level messages",
};

/**
 * Only new replies — the parent message is old (shown muted as context)
 * with new replies indented below it.
 */
export const NewRepliesOnly: Story = {
  render: () => <MockUnreadsView initialUnreads={UNREADS_REPLIES_ONLY} />,
  name: "New replies only — parent shown as context",
};

/** Mix of new top-level messages and new replies on an older message. */
export const Mixed: Story = {
  render: () => <MockUnreadsView initialUnreads={UNREADS_MIXED} />,
  name: "Mixed — new messages and new replies",
};

/** All caught up. */
export const AllCaughtUp: Story = {
  render: () => <MockUnreadsView initialUnreads={[]} />,
  name: "All caught up — empty state",
};
