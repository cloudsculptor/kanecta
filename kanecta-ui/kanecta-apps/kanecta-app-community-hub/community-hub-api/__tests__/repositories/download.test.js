import { jest, describe, test, expect, afterEach } from "@jest/globals";

const mockQuery = jest.fn();
jest.unstable_mockModule("../../db.js", () => ({ default: { query: mockQuery } }));

const { listPublicPagesForExport, getFilesByIds } = await import("../../repositories/download.js");

afterEach(() => mockQuery.mockReset());

describe("download repository", () => {
  test("listPublicPagesForExport selects public, non-deleted pages ordered by title", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });
    await listPublicPagesForExport();
    const [sql] = mockQuery.mock.calls[0];
    expect(sql).toMatch(/FROM pages/);
    expect(sql).toMatch(/public = TRUE AND deleted_at IS NULL/);
    expect(sql).toMatch(/ORDER BY title/);
  });

  test("getFilesByIds binds the id array for a uuid[] ANY() lookup", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });
    await getFilesByIds(["a", "b"]);
    const [sql, params] = mockQuery.mock.calls[0];
    expect(sql).toMatch(/id = ANY\(\$1::uuid\[\]\) AND deleted_at IS NULL/);
    expect(params).toEqual([["a", "b"]]);
  });
});
