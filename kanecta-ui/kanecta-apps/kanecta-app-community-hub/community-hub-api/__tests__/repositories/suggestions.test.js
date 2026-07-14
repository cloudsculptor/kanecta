import { jest, describe, test, expect, afterEach } from "@jest/globals";

const mockQuery = jest.fn();
jest.unstable_mockModule("../../db.js", () => ({ default: { query: mockQuery } }));

const {
  createSuggestion,
  listActiveSuggestions,
  listArchivedSuggestions,
  archiveSuggestion,
} = await import("../../repositories/suggestions.js");

afterEach(() => mockQuery.mockReset());

describe("suggestions repository", () => {
  test("createSuggestion inserts and returns the new row", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 42 }] });
    const row = await createSuggestion({ content: "hi", submittedById: "u1", submittedByName: "Jane" });
    expect(row).toEqual({ id: 42 });
    const [sql, params] = mockQuery.mock.calls[0];
    expect(sql).toMatch(/INSERT INTO suggestions/);
    expect(sql).toMatch(/RETURNING id/);
    expect(params).toEqual(["hi", "u1", "Jane"]);
  });

  test("listActiveSuggestions filters archived_at IS NULL", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });
    await listActiveSuggestions();
    const [sql] = mockQuery.mock.calls[0];
    expect(sql).toMatch(/WHERE archived_at IS NULL/);
    expect(sql).toMatch(/ORDER BY submitted_at DESC/);
  });

  test("listArchivedSuggestions filters archived_at IS NOT NULL", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });
    await listArchivedSuggestions();
    const [sql] = mockQuery.mock.calls[0];
    expect(sql).toMatch(/WHERE archived_at IS NOT NULL/);
  });

  test("archiveSuggestion updates guarded by archived_at IS NULL and returns rowCount", async () => {
    mockQuery.mockResolvedValueOnce({ rowCount: 1 });
    const n = await archiveSuggestion({ id: 7, archivedById: "mod-1" });
    expect(n).toBe(1);
    const [sql, params] = mockQuery.mock.calls[0];
    expect(sql).toMatch(/UPDATE suggestions SET archived_at = NOW\(\)/);
    expect(sql).toMatch(/AND archived_at IS NULL/);
    expect(params).toEqual(["mod-1", 7]);
  });
});
