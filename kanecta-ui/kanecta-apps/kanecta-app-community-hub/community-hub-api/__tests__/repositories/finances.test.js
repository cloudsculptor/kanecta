import { jest, describe, test, expect, afterEach } from "@jest/globals";

const mockQuery = jest.fn();
jest.unstable_mockModule("../../db.js", () => ({ default: { query: mockQuery } }));

const {
  listTransactions,
  createTransaction,
  updateTransaction,
  deleteTransaction,
  getReport,
  listExpenses,
} = await import("../../repositories/finances.js");

afterEach(() => mockQuery.mockReset());

describe("finances repository", () => {
  test("listTransactions with no range has no WHERE and joins the file count", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });
    await listTransactions({});
    const [sql, params] = mockQuery.mock.calls[0];
    expect(sql).not.toMatch(/WHERE/);
    expect(sql).toMatch(/COUNT\(tf\.file_id\)::int AS file_count/);
    expect(sql).toMatch(/ORDER BY t\.date ASC, t\.sort_order ASC, t\.id ASC/);
    expect(params).toEqual([]);
  });

  test("listTransactions with from+to builds ordered positional filters", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });
    await listTransactions({ from: "2026-01-01", to: "2026-06-30" });
    const [sql, params] = mockQuery.mock.calls[0];
    expect(sql).toMatch(/date >= \$1/);
    expect(sql).toMatch(/date <= \$2/);
    expect(params).toEqual(["2026-01-01", "2026-06-30"]);
  });

  test("createTransaction inserts nine columns, defaulting reference and sort_order", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 1 }] });
    const row = await createTransaction({
      date: "2026-01-01", description: "sub", amount: 10, type: "income",
      category: "membership", reference: undefined, sortOrder: undefined,
      createdById: "u1", createdByName: "Jane",
    });
    expect(row).toEqual({ id: 1 });
    const [sql, params] = mockQuery.mock.calls[0];
    expect(sql).toMatch(/INSERT INTO finances_transactions/);
    expect(params).toEqual(["2026-01-01", "sub", 10, "income", "membership", null, 0, "u1", "Jane"]);
  });

  test("updateTransaction returns undefined when the id is absent", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });
    const row = await updateTransaction({ id: 99, date: "d", description: "x", amount: 1, type: "income", category: "membership", reference: null, sortOrder: 0 });
    expect(row).toBeUndefined();
  });

  test("deleteTransaction returns the deleted id, or undefined if not found", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 5 }] });
    expect(await deleteTransaction(5)).toBe(5);
    mockQuery.mockResolvedValueOnce({ rows: [] });
    expect(await deleteTransaction(6)).toBeUndefined();
  });

  test("getReport groups by type and category", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });
    await getReport({ from: "2026-01-01" });
    const [sql, params] = mockQuery.mock.calls[0];
    expect(sql).toMatch(/SUM\(amount\)::NUMERIC\(10,2\) AS total/);
    expect(sql).toMatch(/GROUP BY type, category/);
    expect(params).toEqual(["2026-01-01"]);
  });

  test("listExpenses orders by frequency, supplier, description", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });
    await listExpenses();
    const [sql] = mockQuery.mock.calls[0];
    expect(sql).toMatch(/FROM finances_expenses ORDER BY frequency, supplier, description/);
  });
});
