import { jest, describe, test, expect, afterEach } from "@jest/globals";

const mockQuery = jest.fn();
jest.unstable_mockModule("../../db.js", () => ({ default: { query: mockQuery } }));

const {
  upsertPushSubscription,
  deletePushSubscription,
  getUserSubscriptions,
  getThreadSubscribers,
  deleteSubscriptionById,
  upsertFcmToken,
  deleteFcmToken,
  getPreferences,
  upsertPreference,
} = await import("../../repositories/push.js");

afterEach(() => mockQuery.mockReset());

describe("push repository", () => {
  test("upsertPushSubscription stringifies the subscription and upserts on endpoint", async () => {
    mockQuery.mockResolvedValueOnce({});
    const sub = { endpoint: "https://x/y", keys: {} };
    await upsertPushSubscription("u1", sub);
    const [sql, params] = mockQuery.mock.calls[0];
    expect(sql).toMatch(/INSERT INTO push_subscriptions/);
    expect(sql).toMatch(/ON CONFLICT \(user_id, \(subscription->>'endpoint'\)\)/);
    expect(params).toEqual(["u1", JSON.stringify(sub)]);
  });

  test("deletePushSubscription targets user + endpoint", async () => {
    mockQuery.mockResolvedValueOnce({});
    await deletePushSubscription("u1", "https://x/y");
    const [sql, params] = mockQuery.mock.calls[0];
    expect(sql).toMatch(/DELETE FROM push_subscriptions WHERE user_id = \$1 AND subscription->>'endpoint' = \$2/);
    expect(params).toEqual(["u1", "https://x/y"]);
  });

  test("getThreadSubscribers excludes the author", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });
    await getThreadSubscribers("t1", "author");
    const [sql, params] = mockQuery.mock.calls[0];
    expect(sql).toMatch(/thread_notification_subscriptions tns/);
    expect(sql).toMatch(/tns\.user_id != \$2/);
    expect(params).toEqual(["t1", "author"]);
  });

  test("getUserSubscriptions / deleteSubscriptionById", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 1 }] });
    expect(await getUserSubscriptions("u1")).toEqual([{ id: 1 }]);
    mockQuery.mockResolvedValueOnce({});
    await deleteSubscriptionById(1);
    expect(mockQuery.mock.calls[1][0]).toMatch(/DELETE FROM push_subscriptions WHERE id = \$1/);
    expect(mockQuery.mock.calls[1][1]).toEqual([1]);
  });

  test("upsertFcmToken / deleteFcmToken", async () => {
    mockQuery.mockResolvedValueOnce({});
    await upsertFcmToken("u1", "tok");
    expect(mockQuery.mock.calls[0][0]).toMatch(/INSERT INTO fcm_tokens/);
    expect(mockQuery.mock.calls[0][0]).toMatch(/ON CONFLICT \(user_id, token\) DO NOTHING/);
    mockQuery.mockResolvedValueOnce({});
    await deleteFcmToken("u1", "tok");
    expect(mockQuery.mock.calls[1][1]).toEqual(["u1", "tok"]);
  });

  test("getPreferences / upsertPreference", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ category: "events", enabled: false }] });
    expect(await getPreferences("u1")).toEqual([{ category: "events", enabled: false }]);
    mockQuery.mockResolvedValueOnce({});
    await upsertPreference("u1", "events", true);
    expect(mockQuery.mock.calls[1][0]).toMatch(/INSERT INTO notification_preferences/);
    expect(mockQuery.mock.calls[1][1]).toEqual(["u1", "events", true]);
  });
});
