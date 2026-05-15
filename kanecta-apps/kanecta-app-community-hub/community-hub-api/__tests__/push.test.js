import { jest, describe, test, expect, afterEach } from "@jest/globals";

const mockQuery = jest.fn();
const mockSendNotification = jest.fn();

jest.unstable_mockModule("../db.js", () => ({ default: { query: mockQuery } }));
jest.unstable_mockModule("../middleware/auth.js", () => ({
  requireAuth: (req, res, next) => next(),
}));
jest.unstable_mockModule("web-push", () => ({
  default: {
    setVapidDetails: jest.fn(),
    sendNotification: mockSendNotification,
  },
}));

const { default: express } = await import("express");
const { default: request } = await import("supertest");
const { default: pushRouter } = await import("../routes/push.js");

function makeApp() {
  const app = express();
  app.use(express.json());
  app.use((req, res, next) => {
    req.user = { id: "user-1", name: "Jane Smith", roles: ["team"] };
    next();
  });
  app.use("/api/push", pushRouter);
  return app;
}

const app = makeApp();
afterEach(() => { mockQuery.mockReset(); mockSendNotification.mockReset(); });

// ── POST /api/push/device ─────────────────────────────────────────────────────

describe("POST /api/push/device", () => {
  test("saves subscription and returns ok", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });
    const sub = { endpoint: "https://fcm.example.com/sub1", keys: { auth: "a", p256dh: "b" } };
    const res = await request(app).post("/api/push/device").send({ subscription: sub });
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(mockQuery.mock.calls[0][1][0]).toBe("user-1");
  });

  test("400 when subscription missing", async () => {
    const res = await request(app).post("/api/push/device").send({});
    expect(res.status).toBe(400);
  });

  test("500 on DB error", async () => {
    mockQuery.mockRejectedValueOnce(new Error("db down"));
    const res = await request(app).post("/api/push/device").send({ subscription: { endpoint: "x" } });
    expect(res.status).toBe(500);
  });
});

// ── DELETE /api/push/device ───────────────────────────────────────────────────

describe("DELETE /api/push/device", () => {
  test("removes subscription and returns ok", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });
    const res = await request(app).delete("/api/push/device").send({ endpoint: "https://fcm.example.com/sub1" });
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
  });

  test("400 when endpoint missing", async () => {
    const res = await request(app).delete("/api/push/device").send({});
    expect(res.status).toBe(400);
  });

  test("500 on DB error", async () => {
    mockQuery.mockRejectedValueOnce(new Error("db down"));
    const res = await request(app).delete("/api/push/device").send({ endpoint: "x" });
    expect(res.status).toBe(500);
  });
});
