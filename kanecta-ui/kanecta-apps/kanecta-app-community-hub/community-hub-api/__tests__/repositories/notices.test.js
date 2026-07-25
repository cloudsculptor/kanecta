import { jest, describe, test, expect, afterEach } from "@jest/globals";

const mockQuery = jest.fn();
jest.unstable_mockModule("../../db.js", () => ({ default: { query: mockQuery } }));

const {
  listApprovedNotices,
  listMyNotices,
  listPendingNotices,
  createNotice,
  getNoticeOwner,
  softDeleteNotice,
  approveNotice,
  declineNotice,
} = await import("../../repositories/notices.js");

afterEach(() => mockQuery.mockReset());

describe("notices repository", () => {
  test("listApprovedNotices filters approved + not-deleted, newest first", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });
    await listApprovedNotices();
    const [sql] = mockQuery.mock.calls[0];
    expect(sql).toMatch(/status = 'approved' AND deleted_at IS NULL/);
    expect(sql).toMatch(/ORDER BY submitted_at DESC/);
  });

  test("listMyNotices scopes to the user and excludes deleted", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });
    await listMyNotices("u1");
    const [sql, params] = mockQuery.mock.calls[0];
    expect(sql).toMatch(/submitted_by_id = \$1 AND deleted_at IS NULL/);
    expect(params).toEqual(["u1"]);
  });

  test("listPendingNotices filters pending, oldest first", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });
    await listPendingNotices();
    const [sql] = mockQuery.mock.calls[0];
    expect(sql).toMatch(/status = 'pending' AND deleted_at IS NULL/);
    expect(sql).toMatch(/ORDER BY submitted_at ASC/);
  });

  test("createNotice inserts five columns and returns the id row", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 7 }] });
    const row = await createNotice({ heading: "H", body: "B", noticeDate: null, submittedById: "u1", submittedByName: "Jane" });
    expect(row).toEqual({ id: 7 });
    const [sql, params] = mockQuery.mock.calls[0];
    expect(sql).toMatch(/INSERT INTO notices/);
    expect(params).toEqual(["H", "B", null, "u1", "Jane"]);
  });

  test("getNoticeOwner returns the owner id or null", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ submitted_by_id: "u1" }] });
    expect(await getNoticeOwner(1)).toBe("u1");
    mockQuery.mockResolvedValueOnce({ rows: [] });
    expect(await getNoticeOwner(2)).toBeNull();
  });

  test("softDeleteNotice sets deleted_at", async () => {
    mockQuery.mockResolvedValueOnce({});
    await softDeleteNotice(3);
    const [sql, params] = mockQuery.mock.calls[0];
    expect(sql).toMatch(/UPDATE notices SET deleted_at = NOW\(\) WHERE id = \$1/);
    expect(params).toEqual([3]);
  });

  test("approveNotice / declineNotice guard on pending + not-deleted", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 1 }] });
    await approveNotice({ id: 1, reviewedById: "m", reviewedByName: "Mod" });
    let [sql, params] = mockQuery.mock.calls[0];
    expect(sql).toMatch(/status = 'approved'/);
    expect(sql).toMatch(/WHERE id = \$3 AND status = 'pending' AND deleted_at IS NULL/);
    expect(params).toEqual(["m", "Mod", 1]);

    mockQuery.mockResolvedValueOnce({ rows: [] });
    const declined = await declineNotice({ id: 2, declineReason: "spam", reviewedById: "m", reviewedByName: "Mod" });
    expect(declined).toBeUndefined();
    [sql, params] = mockQuery.mock.calls[1];
    expect(sql).toMatch(/status = 'declined', decline_reason = \$1/);
    expect(params).toEqual(["spam", "m", "Mod", 2]);
  });
});
