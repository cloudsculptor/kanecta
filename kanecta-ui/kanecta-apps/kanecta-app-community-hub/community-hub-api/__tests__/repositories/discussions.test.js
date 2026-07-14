import { jest, describe, test, expect, afterEach } from "@jest/globals";

const mockQuery = jest.fn();
jest.unstable_mockModule("../../db.js", () => ({ default: { query: mockQuery } }));

const repo = await import("../../repositories/discussions.js");

afterEach(() => mockQuery.mockReset());

// ── Message files ─────────────────────────────────────────────────────────────

describe("message files", () => {
  test("attachFilesToMessage no-ops (no query) for an empty/absent file list", async () => {
    await repo.attachFilesToMessage("m1", [], "u1");
    await repo.attachFilesToMessage("m1", undefined, "u1");
    expect(mockQuery).not.toHaveBeenCalled();
  });

  test("attachFilesToMessage inserts owner-scoped files with ON CONFLICT DO NOTHING", async () => {
    mockQuery.mockResolvedValueOnce({});
    await repo.attachFilesToMessage("m1", ["f1", "f2"], "u1");
    const [sql, params] = mockQuery.mock.calls[0];
    expect(sql).toMatch(/INSERT INTO discussions_message_files \(message_id, file_id\)/);
    expect(sql).toMatch(/id = ANY\(\$2::uuid\[\]\) AND uploaded_by_id = \$3/);
    expect(sql).toMatch(/ON CONFLICT DO NOTHING/);
    expect(params).toEqual(["m1", ["f1", "f2"], "u1"]);
  });

  test("getMessageFiles joins files, ordered by attachment time", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ id: "dmf1" }] });
    const rows = await repo.getMessageFiles("m1");
    const [sql, params] = mockQuery.mock.calls[0];
    expect(sql).toMatch(/FROM discussions_message_files dmf/);
    expect(sql).toMatch(/JOIN files f ON f\.id = dmf\.file_id/);
    expect(sql).toMatch(/WHERE dmf\.message_id = \$1/);
    expect(sql).toMatch(/ORDER BY dmf\.created_at/);
    expect(params).toEqual(["m1"]);
    expect(rows).toEqual([{ id: "dmf1" }]);
  });

  test("getFileForDownload / getFileForDelete select the right columns, return undefined when absent", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });
    expect(await repo.getFileForDownload("f1")).toBeUndefined();
    expect(mockQuery.mock.calls[0][0]).toMatch(/SELECT name, storage_key, mime_type FROM files WHERE id = \$1/);
    expect(mockQuery.mock.calls[0][1]).toEqual(["f1"]);

    mockQuery.mockResolvedValueOnce({ rows: [{ id: "f1", storage_key: "k", uploaded_by_id: "u1" }] });
    expect(await repo.getFileForDelete("f1")).toEqual({ id: "f1", storage_key: "k", uploaded_by_id: "u1" });
    expect(mockQuery.mock.calls[1][0]).toMatch(/SELECT id, storage_key, uploaded_by_id FROM files WHERE id = \$1/);
  });

  test("setMessageFilePreview scopes the update to the message author", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ id: "dmf1" }] });
    const row = await repo.setMessageFilePreview("dmf1", true, "u1");
    const [sql, params] = mockQuery.mock.calls[0];
    expect(sql).toMatch(/UPDATE discussions_message_files dmf/);
    expect(sql).toMatch(/FROM discussions_messages m/);
    expect(sql).toMatch(/dmf\.id = \$2 AND dmf\.message_id = m\.id AND m\.user_id = \$3/);
    expect(sql).toMatch(/RETURNING dmf\.id/);
    expect(params).toEqual([true, "dmf1", "u1"]);
    expect(row).toEqual({ id: "dmf1" });
  });
});

// ── Threads ───────────────────────────────────────────────────────────────────

describe("threads", () => {
  test("hasThreadReads returns a boolean from row presence", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });
    expect(await repo.hasThreadReads("u1")).toBe(false);
    mockQuery.mockResolvedValueOnce({ rows: [{ "?column?": 1 }] });
    expect(await repo.hasThreadReads("u1")).toBe(true);
    expect(mockQuery.mock.calls[0][0]).toMatch(/SELECT 1 FROM discussions_thread_reads WHERE user_id = \$1 LIMIT 1/);
    expect(mockQuery.mock.calls[0][1]).toEqual(["u1"]);
  });

  test("seedThreadReads inserts read markers for all live threads", async () => {
    mockQuery.mockResolvedValueOnce({});
    await repo.seedThreadReads("u1");
    const [sql, params] = mockQuery.mock.calls[0];
    expect(sql).toMatch(/INSERT INTO discussions_thread_reads \(user_id, thread_id, last_read_at\)/);
    expect(sql).toMatch(/COALESCE\(latest_message_at, NOW\(\)\)/);
    expect(sql).toMatch(/WHERE archived_at IS NULL/);
    expect(sql).toMatch(/ON CONFLICT DO NOTHING/);
    expect(params).toEqual(["u1"]);
  });

  test("listThreads joins reads + subscriptions and orders by sort_order then name", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ id: "t1" }] });
    await repo.listThreads("u1");
    const [sql, params] = mockQuery.mock.calls[0];
    expect(sql).toMatch(/AS has_unread/);
    expect(sql).toMatch(/AS is_notifications_enabled/);
    expect(sql).toMatch(/LEFT JOIN discussions_thread_reads r ON r\.thread_id = t\.id AND r\.user_id = \$1/);
    expect(sql).toMatch(/LEFT JOIN thread_notification_subscriptions tns/);
    expect(sql).toMatch(/WHERE t\.archived_at IS NULL/);
    expect(sql).toMatch(/ORDER BY t\.sort_order ASC NULLS LAST, t\.name ASC/);
    expect(params).toEqual(["u1"]);
  });

  test("findDuplicateThreads matches whitespace-insensitive lowercased names", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });
    await repo.findDuplicateThreads("general");
    const [sql, params] = mockQuery.mock.calls[0];
    expect(sql).toMatch(/LOWER\(REGEXP_REPLACE\(name, '\\s\+', '', 'g'\)\) = \$1/);
    expect(sql).toMatch(/archived_at IS NULL/);
    expect(params).toEqual(["general"]);
  });

  test("createThread inserts four columns and returns the row", async () => {
    const thread = { id: "t1", name: "General" };
    mockQuery.mockResolvedValueOnce({ rows: [thread] });
    const row = await repo.createThread({ name: "General", description: null, createdByUserId: "u1", createdByName: "Jane" });
    const [sql, params] = mockQuery.mock.calls[0];
    expect(sql).toMatch(/INSERT INTO discussions_threads \(name, description, created_by_user_id, created_by_name\)/);
    expect(sql).toMatch(/RETURNING \*/);
    expect(params).toEqual(["General", null, "u1", "Jane"]);
    expect(row).toEqual(thread);
  });

  test("getThreadForArchive selects creator fields for live threads only", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ created_by_user_id: "u1", created_by_name: "Jane" }] });
    const row = await repo.getThreadForArchive("t1");
    const [sql, params] = mockQuery.mock.calls[0];
    expect(sql).toMatch(/SELECT created_by_user_id, created_by_name FROM discussions_threads/);
    expect(sql).toMatch(/WHERE id = \$1 AND archived_at IS NULL/);
    expect(params).toEqual(["t1"]);
    expect(row).toEqual({ created_by_user_id: "u1", created_by_name: "Jane" });
  });

  test("archiveThread sets archived_at", async () => {
    mockQuery.mockResolvedValueOnce({});
    await repo.archiveThread("t1");
    const [sql, params] = mockQuery.mock.calls[0];
    expect(sql).toMatch(/UPDATE discussions_threads SET archived_at = NOW\(\) WHERE id = \$1/);
    expect(params).toEqual(["t1"]);
  });

  test("getThreadName / touchThreadLatestMessage", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ name: "General" }] });
    expect(await repo.getThreadName("t1")).toEqual({ name: "General" });
    expect(mockQuery.mock.calls[0][0]).toMatch(/SELECT name FROM discussions_threads WHERE id = \$1/);

    mockQuery.mockResolvedValueOnce({});
    await repo.touchThreadLatestMessage("t1", "2026-01-01");
    expect(mockQuery.mock.calls[1][0]).toMatch(/UPDATE discussions_threads SET latest_message_at = \$1 WHERE id = \$2/);
    expect(mockQuery.mock.calls[1][1]).toEqual(["2026-01-01", "t1"]);
  });
});

// ── Messages ──────────────────────────────────────────────────────────────────

describe("messages", () => {
  test("listThreadMessages without before binds [threadId, limit]", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });
    await repo.listThreadMessages("t1", 50, undefined);
    const [sql, params] = mockQuery.mock.calls[0];
    expect(sql).toMatch(/AS reply_count/);
    expect(sql).toMatch(/parent_message_id IS NULL/);
    expect(sql).not.toMatch(/created_at < \$3/);
    expect(sql).toMatch(/ORDER BY created_at ASC/);
    expect(sql).toMatch(/LIMIT \$2/);
    expect(params).toEqual(["t1", 50]);
  });

  test("listThreadMessages with before adds the $3 predicate and binds three params", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });
    await repo.listThreadMessages("t1", 50, "2026-01-01T00:00:00Z");
    const [sql, params] = mockQuery.mock.calls[0];
    expect(sql).toMatch(/AND created_at < \$3/);
    expect(params).toEqual(["t1", 50, "2026-01-01T00:00:00Z"]);
  });

  test("createMessage returns literal 0 reply_count", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ id: "m1", reply_count: 0 }] });
    const row = await repo.createMessage({ threadId: "t1", userId: "u1", userName: "Jane", content: "Hi" });
    const [sql, params] = mockQuery.mock.calls[0];
    expect(sql).toMatch(/INSERT INTO discussions_messages \(thread_id, user_id, user_name, content\)/);
    expect(sql).toMatch(/RETURNING \*, 0 AS reply_count/);
    expect(params).toEqual(["t1", "u1", "Jane", "Hi"]);
    expect(row).toEqual({ id: "m1", reply_count: 0 });
  });

  test("upsertThreadRead only advances the marker (never backwards)", async () => {
    mockQuery.mockResolvedValueOnce({});
    await repo.upsertThreadRead("u1", "t1", "2026-01-02");
    const [sql, params] = mockQuery.mock.calls[0];
    expect(sql).toMatch(/ON CONFLICT \(user_id, thread_id\) DO UPDATE SET last_read_at = EXCLUDED\.last_read_at/);
    expect(sql).toMatch(/WHERE EXCLUDED\.last_read_at > discussions_thread_reads\.last_read_at/);
    expect(params).toEqual(["u1", "t1", "2026-01-02"]);
  });

  test("updateMessage scopes to author + not-deleted", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ id: "m1" }] });
    await repo.updateMessage("m1", "edited", "u1");
    const [sql, params] = mockQuery.mock.calls[0];
    expect(sql).toMatch(/SET content = \$1, edited_at = NOW\(\)/);
    expect(sql).toMatch(/WHERE id = \$2 AND user_id = \$3 AND deleted_at IS NULL/);
    expect(params).toEqual(["edited", "m1", "u1"]);
  });

  test("deleteMessage as moderator omits the user_id filter and binds only [id]", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ id: "m1" }] });
    await repo.deleteMessage("m1", "u1", true);
    const [sql, params] = mockQuery.mock.calls[0];
    expect(sql).toMatch(/SET deleted_at = NOW\(\), content = ''/);
    expect(sql).not.toMatch(/AND user_id = \$2/);
    expect(params).toEqual(["m1"]);
  });

  test("deleteMessage as team member keeps the author filter and binds [id, userId]", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ id: "m1" }] });
    await repo.deleteMessage("m1", "u1", false);
    const [sql, params] = mockQuery.mock.calls[0];
    expect(sql).toMatch(/WHERE id = \$1 AND user_id = \$2 AND deleted_at IS NULL/);
    expect(params).toEqual(["m1", "u1"]);
  });
});

// ── Replies ───────────────────────────────────────────────────────────────────

describe("replies", () => {
  test("listReplies selects by parent_message_id, oldest first", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });
    await repo.listReplies("m1");
    const [sql, params] = mockQuery.mock.calls[0];
    expect(sql).toMatch(/WHERE parent_message_id = \$1/);
    expect(sql).toMatch(/ORDER BY created_at ASC/);
    expect(params).toEqual(["m1"]);
  });

  test("getParentMessage only matches top-level messages", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ id: "m1", thread_id: "t1" }] });
    const row = await repo.getParentMessage("m1");
    expect(mockQuery.mock.calls[0][0]).toMatch(
      /SELECT id, thread_id FROM discussions_messages WHERE id = \$1 AND parent_message_id IS NULL/
    );
    expect(row).toEqual({ id: "m1", thread_id: "t1" });
  });

  test("createReply inserts parent_message_id and returns the row", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ id: "r1" }] });
    await repo.createReply({ threadId: "t1", parentMessageId: "m1", userId: "u1", userName: "Jane", content: "Re" });
    const [sql, params] = mockQuery.mock.calls[0];
    expect(sql).toMatch(/INSERT INTO discussions_messages \(thread_id, parent_message_id, user_id, user_name, content\)/);
    expect(params).toEqual(["t1", "m1", "u1", "Jane", "Re"]);
  });
});

// ── Notification subscriptions ────────────────────────────────────────────────

describe("notification subscriptions", () => {
  test("subscribe is idempotent (ON CONFLICT DO NOTHING)", async () => {
    mockQuery.mockResolvedValueOnce({});
    await repo.subscribeThreadNotifications("u1", "t1");
    const [sql, params] = mockQuery.mock.calls[0];
    expect(sql).toMatch(/INSERT INTO thread_notification_subscriptions \(user_id, thread_id\)/);
    expect(sql).toMatch(/ON CONFLICT DO NOTHING/);
    expect(params).toEqual(["u1", "t1"]);
  });

  test("unsubscribe deletes the row", async () => {
    mockQuery.mockResolvedValueOnce({});
    await repo.unsubscribeThreadNotifications("u1", "t1");
    const [sql, params] = mockQuery.mock.calls[0];
    expect(sql).toMatch(/DELETE FROM thread_notification_subscriptions WHERE user_id = \$1 AND thread_id = \$2/);
    expect(params).toEqual(["u1", "t1"]);
  });
});

// ── Read state ────────────────────────────────────────────────────────────────

describe("read state", () => {
  test("listUnreads excludes own messages and binds only [userId]", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });
    await repo.listUnreads("u1");
    const [sql, params] = mockQuery.mock.calls[0];
    expect(sql).toMatch(/JOIN discussions_thread_reads rd ON rd\.thread_id = t\.id AND rd\.user_id = \$1/);
    expect(sql).toMatch(/m\.user_id != \$1/);
    expect(sql).toMatch(/GROUP BY t\.id, t\.name, rd\.last_read_at/);
    expect(params).toEqual(["u1"]);
  });

  test("markThreadRead sets the marker to the latest message time (or now)", async () => {
    mockQuery.mockResolvedValueOnce({});
    await repo.markThreadRead("u1", "t1");
    const [sql, params] = mockQuery.mock.calls[0];
    expect(sql).toMatch(/SELECT MAX\(created_at\) FROM discussions_messages WHERE thread_id = \$2/);
    expect(sql).toMatch(/ON CONFLICT \(user_id, thread_id\)\s+DO UPDATE SET last_read_at = EXCLUDED\.last_read_at/);
    expect(params).toEqual(["u1", "t1"]);
  });
});

// ── Reactions ─────────────────────────────────────────────────────────────────

describe("reactions", () => {
  test("getThreadReactions aggregates per message + emoji across the thread", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });
    await repo.getThreadReactions("t1");
    const [sql, params] = mockQuery.mock.calls[0];
    expect(sql).toMatch(/array_agg\(dr\.user_id\) AS user_ids, array_agg\(dr\.user_name\) AS user_names/);
    expect(sql).toMatch(/JOIN discussions_messages dm ON dm\.id = dr\.message_id/);
    expect(sql).toMatch(/WHERE dm\.thread_id = \$1/);
    expect(sql).toMatch(/GROUP BY dr\.message_id, dr\.emoji/);
    expect(params).toEqual(["t1"]);
  });

  test("addReaction is idempotent; removeReaction scopes to user + emoji", async () => {
    mockQuery.mockResolvedValueOnce({});
    await repo.addReaction("m1", "u1", "Jane", "👍");
    expect(mockQuery.mock.calls[0][0]).toMatch(/INSERT INTO discussions_reactions \(message_id, user_id, user_name, emoji\)/);
    expect(mockQuery.mock.calls[0][0]).toMatch(/ON CONFLICT DO NOTHING/);
    expect(mockQuery.mock.calls[0][1]).toEqual(["m1", "u1", "Jane", "👍"]);

    mockQuery.mockResolvedValueOnce({});
    await repo.removeReaction("m1", "u1", "👍");
    expect(mockQuery.mock.calls[1][0]).toMatch(
      /DELETE FROM discussions_reactions WHERE message_id = \$1 AND user_id = \$2 AND emoji = \$3/
    );
    expect(mockQuery.mock.calls[1][1]).toEqual(["m1", "u1", "👍"]);
  });

  test("getMessageReactions groups by emoji for one message", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ emoji: "👍", count: "1" }] });
    await repo.getMessageReactions("m1");
    const [sql, params] = mockQuery.mock.calls[0];
    expect(sql).toMatch(/FROM discussions_reactions WHERE message_id = \$1 GROUP BY emoji/);
    expect(params).toEqual(["m1"]);
  });

  test("getMessageThreadId returns the owning thread", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ thread_id: "t1" }] });
    expect(await repo.getMessageThreadId("m1")).toEqual({ thread_id: "t1" });
    expect(mockQuery.mock.calls[0][0]).toMatch(/SELECT thread_id FROM discussions_messages WHERE id = \$1/);
  });
});
