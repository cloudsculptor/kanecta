import type { Meta, StoryObj } from "@storybook/react-vite";

// ── Types ─────────────────────────────────────────────────────────────────────

interface MockThread {
  id: string;
  name: string;
  description?: string;
  has_unread: boolean;
}

// ── Mock sidebar using real CSS classes ───────────────────────────────────────

function MockSidebar({ threads, activeId }: { threads: MockThread[]; activeId?: string }) {
  const unreadThreads = threads.filter((t) => t.has_unread);

  return (
    <aside className="discussions-sidebar" style={{ height: "100%" }}>
      {unreadThreads.length > 0 && (
        <>
          <div className="discussions-sidebar__section-label">Unreads</div>
          <ul className="discussions-sidebar__list discussions-sidebar__list--unreads">
            {unreadThreads.map((t) => (
              <li key={t.id}>
                <button
                  className={`discussions-thread-item discussions-thread-item--unread${t.id === activeId ? " discussions-thread-item--active" : ""}`}
                >
                  <span className="discussions-thread-item__hash">#</span>
                  <span className="discussions-thread-item__content">
                    <span className="discussions-thread-item__name">{t.name}</span>
                  </span>
                  <span className="discussions-thread-item__dot" />
                </button>
              </li>
            ))}
          </ul>
        </>
      )}

      <div className="discussions-sidebar__heading">
        Threads
        <button className="discussions-sidebar__new">+</button>
      </div>

      <ul className="discussions-sidebar__list">
        {threads.map((t) => (
          <li key={t.id}>
            <button
              className={`discussions-thread-item${t.has_unread ? " discussions-thread-item--unread" : ""}${t.id === activeId ? " discussions-thread-item--active" : ""}`}
            >
              <span className="discussions-thread-item__hash">#</span>
              <span className="discussions-thread-item__content">
                <span className="discussions-thread-item__name">{t.name}</span>
                {t.description && (
                  <span className="discussions-thread-item__preview">{t.description}</span>
                )}
              </span>
              {t.has_unread && t.id !== activeId && (
                <span className="discussions-thread-item__dot" />
              )}
            </button>
          </li>
        ))}
      </ul>
    </aside>
  );
}

// ── Fixtures ──────────────────────────────────────────────────────────────────

const ALL_THREADS: MockThread[] = [
  { id: "t1", name: "general", description: "Morning everyone!", has_unread: false },
  { id: "t2", name: "events", description: "Saturday market is on at 8am", has_unread: true },
  { id: "t3", name: "transport", description: "Two seats free to Wellington", has_unread: false },
  { id: "t4", name: "resilience", description: "Meeting notes now posted", has_unread: true },
  { id: "t5", name: "local-help", description: "Looking for a plumber", has_unread: false },
];

const NO_UNREADS: MockThread[] = ALL_THREADS.map((t) => ({ ...t, has_unread: false }));

// ── Stories ───────────────────────────────────────────────────────────────────

const meta: Meta = {
  title: "Discussions/ThreadSidebar",
  decorators: [
    (Story) => (
      <div className="discussions-layout" style={{ height: 520, width: 220 }}>
        <Story />
      </div>
    ),
  ],
};
export default meta;
type Story = StoryObj;

/** No new activity — the UNREADS section is hidden and all thread names are normal weight. */
export const AllRead: Story = {
  render: () => <MockSidebar threads={NO_UNREADS} activeId="t1" />,
  name: "All read — no unreads section",
};

/**
 * Two threads have new messages. The UNREADS section appears at the top with bold names
 * and a green dot. The same threads show bold + dot in the full Threads list below.
 */
export const WithUnreads: Story = {
  render: () => <MockSidebar threads={ALL_THREADS} activeId="t1" />,
  name: "With unreads — section + indicators",
};

/**
 * The active thread is unread (e.g. opened before all messages loaded).
 * It appears in the UNREADS section but without a dot in the Threads list,
 * since the user is already looking at it.
 */
export const ActiveThreadIsUnread: Story = {
  render: () => <MockSidebar threads={ALL_THREADS} activeId="t2" />,
  name: "Active thread is unread — dot suppressed in list",
};

/** All threads have new messages — entire UNREADS section fills with items. */
export const AllUnread: Story = {
  render: () => (
    <MockSidebar
      threads={ALL_THREADS.map((t) => ({ ...t, has_unread: true }))}
      activeId="t1"
    />
  ),
  name: "All threads unread",
};
