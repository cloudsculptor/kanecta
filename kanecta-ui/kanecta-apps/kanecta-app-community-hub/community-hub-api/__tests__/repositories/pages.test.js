import { jest, describe, test, expect, afterEach } from "@jest/globals";

const mockQuery = jest.fn();
const mockConnect = jest.fn();
jest.unstable_mockModule("../../db.js", () => ({ default: { query: mockQuery, connect: mockConnect } }));

const {
  listPages,
  getPageBySlug,
  getPageIdBySlug,
  softDeletePage,
  archivePage,
  unarchivePage,
  createPageWithHistory,
  updatePageWithHistory,
} = await import("../../repositories/pages.js");

afterEach(() => { mockQuery.mockReset(); mockConnect.mockReset(); });

// A fake transaction client that records queries and returns scripted results.
function fakeClient(scriptedResults = []) {
  let i = 0;
  const calls = [];
  return {
    query: (sql, params) => {
      calls.push([sql, params]);
      // BEGIN/COMMIT/ROLLBACK take no scripted result.
      if (/^(BEGIN|COMMIT|ROLLBACK)/.test(sql.trim())) return Promise.resolve({});
      return Promise.resolve(scriptedResults[i++] ?? { rows: [] });
    },
    release: jest.fn(),
    calls,
  };
}

describe("pages repository — reads", () => {
  test("listPages filters non-deleted by default, newest first, exposes archived_at", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });
    await listPages();
    const [sql, params] = mockQuery.mock.calls[0];
    expect(sql).toMatch(/FROM pages p/);
    expect(sql).toMatch(/WHERE \(\$1 OR p\.deleted_at IS NULL\)/);
    expect(sql).toMatch(/p\.deleted_at AS archived_at/);
    expect(sql).toMatch(/ORDER BY p\.updated_at DESC/);
    expect(params).toEqual([false]);
  });

  test("listPages includeArchived=true lifts the deleted_at filter", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });
    await listPages(true);
    const [, params] = mockQuery.mock.calls[0];
    expect(params).toEqual([true]);
  });

  test("archivePage stamps deleted_at on the live row only", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ id: "p1" }] });
    expect(await archivePage("s")).toEqual({ id: "p1" });
    const [sql, params] = mockQuery.mock.calls[0];
    expect(sql).toMatch(/SET deleted_at = NOW\(\)/);
    expect(sql).toMatch(/deleted_at IS NULL/);
    expect(params).toEqual(["s"]);
    mockQuery.mockResolvedValueOnce({ rows: [] });
    expect(await archivePage("missing")).toBeNull();
  });

  test("unarchivePage clears deleted_at on the archived row only", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ id: "p1" }] });
    expect(await unarchivePage("s")).toEqual({ id: "p1" });
    const [sql, params] = mockQuery.mock.calls[0];
    expect(sql).toMatch(/SET deleted_at = NULL/);
    expect(sql).toMatch(/deleted_at IS NOT NULL/);
    expect(params).toEqual(["s"]);
    mockQuery.mockResolvedValueOnce({ rows: [] });
    expect(await unarchivePage("missing")).toBeNull();
  });

  test("getPageBySlug joins licence + group and returns the row or null", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ id: "p1" }] });
    expect(await getPageBySlug("s")).toEqual({ id: "p1" });
    const [sql] = mockQuery.mock.calls[0];
    expect(sql).toMatch(/LEFT JOIN licences l/);
    expect(sql).toMatch(/LEFT JOIN groups g/);
    mockQuery.mockResolvedValueOnce({ rows: [] });
    expect(await getPageBySlug("missing")).toBeNull();
  });

  test("getPageIdBySlug / softDeletePage", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ id: "p1" }] });
    expect(await getPageIdBySlug("s")).toEqual({ id: "p1" });
    mockQuery.mockResolvedValueOnce({});
    await softDeletePage("s");
    expect(mockQuery.mock.calls[1][0]).toMatch(/UPDATE pages SET deleted_at = NOW\(\) WHERE slug = \$1/);
  });
});

describe("pages repository — transactions", () => {
  test("createPageWithHistory inserts the page + a Created history row and commits", async () => {
    const client = fakeClient([{ rows: [{ id: "p1", slug: "s" }] }]); // the INSERT ... RETURNING *
    mockConnect.mockResolvedValueOnce(client);
    const page = await createPageWithHistory({
      slug: "s", title: "T", contentJson: { root: {} },
      createdById: "u1", createdByName: "Jane", licenceId: null, ownerType: "group", ownerId: "g1",
    });
    expect(page).toEqual({ id: "p1", slug: "s" });
    const sqls = client.calls.map((c) => c[0].trim().split(/\s+/).slice(0, 2).join(" "));
    expect(sqls[0]).toBe("BEGIN");
    expect(client.calls[1][0]).toMatch(/INSERT INTO pages/);
    expect(client.calls[2][0]).toMatch(/INSERT INTO page_history/);
    expect(sqls[sqls.length - 1]).toBe("COMMIT");
    expect(client.release).toHaveBeenCalled();
  });

  test("updatePageWithHistory derives Published action and returns { row, action }", async () => {
    const client = fakeClient([
      { rows: [{ id: "p1", content_json: { root: {} }, public: false, version: 1 }] }, // SELECT existing
      { rows: [{ id: "p1", slug: "s", title: "T" }] }, // UPDATE ... RETURNING *
    ]);
    mockConnect.mockResolvedValueOnce(client);
    const result = await updatePageWithHistory({
      currentSlug: "s", targetSlug: "s", title: "T", contentJson: { root: {} },
      licenceId: undefined, isPublic: true, ownerType: undefined, ownerId: undefined,
      userId: "u1", userName: "Jane",
    });
    expect(result.action).toBe("Published");
    expect(result.row).toEqual({ id: "p1", slug: "s", title: "T" });
    // version bumped to 2 in both the UPDATE and the history insert
    const updateCall = client.calls.find((c) => /UPDATE pages/.test(c[0]));
    expect(updateCall[1][5]).toBe(2); // version param
  });

  test("updatePageWithHistory rolls back and returns null when the page is missing", async () => {
    const client = fakeClient([{ rows: [] }]); // SELECT existing → none
    mockConnect.mockResolvedValueOnce(client);
    const result = await updatePageWithHistory({
      currentSlug: "missing", targetSlug: "missing", title: "T", contentJson: {},
      licenceId: undefined, isPublic: undefined, ownerType: undefined, ownerId: undefined,
      userId: "u1", userName: "Jane",
    });
    expect(result).toBeNull();
    expect(client.calls.some((c) => /ROLLBACK/.test(c[0]))).toBe(true);
    expect(client.calls.some((c) => /COMMIT/.test(c[0]))).toBe(false);
  });
});
