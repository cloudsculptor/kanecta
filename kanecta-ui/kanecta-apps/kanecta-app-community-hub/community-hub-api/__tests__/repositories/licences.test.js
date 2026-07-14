import { jest, describe, test, expect, afterEach } from "@jest/globals";

const mockQuery = jest.fn();
jest.unstable_mockModule("../../db.js", () => ({ default: { query: mockQuery } }));

const { listLicences } = await import("../../repositories/licences.js");

afterEach(() => mockQuery.mockReset());

describe("licences repository", () => {
  test("listLicences selects ordered by sort_order and returns rows", async () => {
    const rows = [{ id: 1, name: "CC BY" }];
    mockQuery.mockResolvedValueOnce({ rows });
    const result = await listLicences();
    expect(result).toBe(rows);
    expect(mockQuery).toHaveBeenCalledTimes(1);
    const [sql] = mockQuery.mock.calls[0];
    expect(sql).toMatch(/FROM licences/);
    expect(sql).toMatch(/ORDER BY sort_order/);
  });
});
