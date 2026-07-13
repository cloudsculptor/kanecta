import { jest, describe, test, expect, afterEach } from "@jest/globals";

const mockQuery = jest.fn();
jest.unstable_mockModule("../../db.js", () => ({ default: { query: mockQuery } }));

const { getEndorsementFor, isEndorsed, createEndorsement } = await import("../../repositories/trust.js");

afterEach(() => mockQuery.mockReset());

describe("trust repository", () => {
  test("getEndorsementFor returns the earliest record or null", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ endorsed_by_id: "u2" }] });
    expect(await getEndorsementFor("u1")).toEqual({ endorsed_by_id: "u2" });
    const [sql, params] = mockQuery.mock.calls[0];
    expect(sql).toMatch(/FROM trust WHERE user_id = \$1/);
    expect(sql).toMatch(/ORDER BY created_at ASC LIMIT 1/);
    expect(params).toEqual(["u1"]);

    mockQuery.mockResolvedValueOnce({ rows: [] });
    expect(await getEndorsementFor("root")).toBeNull();
  });

  test("isEndorsed is true only when a trust row exists", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 1 }] });
    expect(await isEndorsed("u1")).toBe(true);
    mockQuery.mockResolvedValueOnce({ rows: [] });
    expect(await isEndorsed("root")).toBe(false);
  });

  test("createEndorsement inserts all seven columns in order", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });
    await createEndorsement({
      userId: "u1", endorsedById: "mod", knowPersonally: true, trustedBySomeone: false,
      resilienceHui: false, otherReason: "met at hui", locality: "local",
    });
    const [sql, params] = mockQuery.mock.calls[0];
    expect(sql).toMatch(/INSERT INTO trust/);
    expect(params).toEqual(["u1", "mod", true, false, false, "met at hui", "local"]);
  });
});
