import { jest, describe, test, expect, afterEach } from "@jest/globals";

const mockQuery = jest.fn();

jest.unstable_mockModule("../db.js", () => ({ default: { query: mockQuery } }));
jest.unstable_mockModule("../middleware/auth.js", () => ({
  requireAuth: (req, res, next) => next(),
  requireRole: (...roles) => (req, res, next) => {
    const has = roles.some((r) => req.user?.roles.includes(r));
    if (!has) return res.status(403).json({ error: "Insufficient role" });
    next();
  },
}));

const { default: express } = await import("express");
const { default: request } = await import("supertest");
const { default: discussionsRouter } = await import("../routes/discussions.js");

function makeApp(roles = ["team"]) {
  const app = express();
  app.use(express.json());
  app.use((req, res, next) => {
    req.user = { id: "user-1", name: "Jane Smith", roles };
    next();
  });
  app.use("/api/discussions", discussionsRouter);
  return app;
}

const teamApp = makeApp(["team"]);
const moderatorApp = makeApp(["moderator"]);

afterEach(() => mockQuery.mockReset());

// ── Users ─────────────────────────────────────────────────────────────────────

describe("GET /api/discussions/users", () => {
  test("returns distinct users", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ id: "u1", name: "Jane Smith" }] });
    const res = await request(teamApp).get("/api/discussions/users");
    expect(res.status).toBe(200);
    expect(res.body[0].name).toBe("Jane Smith");
  });

  test("500 on DB error", async () => {
    mockQuery.mockRejectedValueOnce(new Error("db down"));
    const res = await request(teamApp).get("/api/discussions/users");
    expect(res.status).toBe(500);
  });
});

// ── Additional edge cases ─────────────────────────────────────────────────────

describe("GET /api/discussions/threads/:threadId/messages with before param", () => {
  test("accepts before query param for pagination", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });
    const res = await request(teamApp)
      .get("/api/discussions/threads/t1/messages?before=2026-01-01T00:00:00Z");
    expect(res.status).toBe(200);
    // before param should be passed as 3rd query arg
    expect(mockQuery.mock.calls[0][1]).toHaveLength(3);
  });
});

describe("POST /api/discussions/threads whitespace trimming", () => {
  test("400 when name is only whitespace", async () => {
    const res = await request(teamApp).post("/api/discussions/threads").send({ name: "   " });
    expect(res.status).toBe(400);
  });
});

describe("POST /api/discussions/threads/:threadId/messages whitespace trimming", () => {
  test("400 when content is only whitespace", async () => {
    const res = await request(teamApp)
      .post("/api/discussions/threads/t1/messages")
      .send({ content: "   " });
    expect(res.status).toBe(400);
  });
});

describe("GET /api/discussions/messages/:id/replies", () => {
  test("returns replies", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ id: "r1", content: "reply" }] });
    const res = await request(teamApp).get("/api/discussions/messages/m1/replies");
    expect(res.status).toBe(200);
    expect(res.body[0].content).toBe("reply");
  });

  test("500 on DB error", async () => {
    mockQuery.mockRejectedValueOnce(new Error("db down"));
    const res = await request(teamApp).get("/api/discussions/messages/m1/replies");
    expect(res.status).toBe(500);
  });
});

// ── Threads ──────────────────────────────────────────────────────────────────

describe("GET /api/discussions/threads", () => {
  test("returns threads", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ id: "t1", name: "General" }] });
    const res = await request(teamApp).get("/api/discussions/threads");
    expect(res.status).toBe(200);
    expect(res.body).toEqual([{ id: "t1", name: "General" }]);
  });

  test("500 on DB error", async () => {
    mockQuery.mockRejectedValueOnce(new Error("db down"));
    const res = await request(teamApp).get("/api/discussions/threads");
    expect(res.status).toBe(500);
  });
});

describe("POST /api/discussions/threads", () => {
  test("400 when name is missing", async () => {
    const res = await request(teamApp).post("/api/discussions/threads").send({});
    expect(res.status).toBe(400);
  });

  test("creates thread and returns 201", async () => {
    const thread = { id: "t1", name: "General", created_by_name: "Jane Smith" };
    mockQuery.mockResolvedValueOnce({ rows: [] }); // no duplicate
    mockQuery.mockResolvedValueOnce({ rows: [thread] }); // insert
    const res = await request(teamApp).post("/api/discussions/threads").send({ name: "General" });
    expect(res.status).toBe(201);
    expect(res.body.name).toBe("General");
  });

  test("returns 409 with existing thread when name is a duplicate", async () => {
    const existing = { id: "t1", name: "General", description: null };
    mockQuery.mockResolvedValueOnce({ rows: [existing] });
    const res = await request(teamApp).post("/api/discussions/threads").send({ name: "  general  " });
    expect(res.status).toBe(409);
    expect(res.body.existing.id).toBe("t1");
    expect(res.body.existing.name).toBe("General");
  });
});

// ── Messages ─────────────────────────────────────────────────────────────────

describe("GET /api/discussions/threads/:threadId/messages", () => {
  test("returns messages", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ id: "m1", content: "Hello", reply_count: "0" }] });
    const res = await request(teamApp).get("/api/discussions/threads/t1/messages");
    expect(res.status).toBe(200);
    expect(res.body[0].content).toBe("Hello");
  });
});

describe("POST /api/discussions/threads/:threadId/messages", () => {
  test("400 when content is missing", async () => {
    const res = await request(teamApp).post("/api/discussions/threads/t1/messages").send({});
    expect(res.status).toBe(400);
  });

  test("creates message and returns 201", async () => {
    const msg = { id: "m1", thread_id: "t1", content: "Hello", reply_count: 0 };
    mockQuery.mockResolvedValueOnce({ rows: [msg] });
    const res = await request(teamApp).post("/api/discussions/threads/t1/messages").send({ content: "Hello" });
    expect(res.status).toBe(201);
    expect(res.body.content).toBe("Hello");
  });
});

describe("PUT /api/discussions/messages/:id", () => {
  test("400 when content is missing", async () => {
    const res = await request(teamApp).put("/api/discussions/messages/m1").send({});
    expect(res.status).toBe(400);
  });

  test("404 when message not found or not owned", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });
    const res = await request(teamApp).put("/api/discussions/messages/m1").send({ content: "Updated" });
    expect(res.status).toBe(404);
  });

  test("updates message", async () => {
    const msg = { id: "m1", thread_id: "t1", content: "Updated" };
    mockQuery.mockResolvedValueOnce({ rows: [msg] });
    const res = await request(teamApp).put("/api/discussions/messages/m1").send({ content: "Updated" });
    expect(res.status).toBe(200);
    expect(res.body.content).toBe("Updated");
  });
});

describe("DELETE /api/discussions/messages/:id", () => {
  test("team member gets 404 if message not theirs", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });
    const res = await request(teamApp).delete("/api/discussions/messages/m1");
    expect(res.status).toBe(404);
  });

  test("team member deletes own message", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ id: "m1", thread_id: "t1" }] });
    const res = await request(teamApp).delete("/api/discussions/messages/m1");
    expect(res.status).toBe(200);
  });

  test("moderator can delete any message — query has no user_id filter", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ id: "m1", thread_id: "t1" }] });
    const res = await request(moderatorApp).delete("/api/discussions/messages/m1");
    expect(res.status).toBe(200);
    expect(mockQuery.mock.calls[0][1]).toEqual(["m1"]);
  });
});

// ── Replies ───────────────────────────────────────────────────────────────────

describe("POST /api/discussions/messages/:id/replies", () => {
  test("400 when content missing", async () => {
    const res = await request(teamApp).post("/api/discussions/messages/m1/replies").send({});
    expect(res.status).toBe(400);
  });

  test("404 when parent message not found", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });
    const res = await request(teamApp).post("/api/discussions/messages/m1/replies").send({ content: "Reply" });
    expect(res.status).toBe(404);
  });

  test("creates reply", async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ id: "m1", thread_id: "t1" }] })
      .mockResolvedValueOnce({ rows: [{ id: "r1", content: "Reply" }] });
    const res = await request(teamApp).post("/api/discussions/messages/m1/replies").send({ content: "Reply" });
    expect(res.status).toBe(201);
  });
});

// ── Reactions ─────────────────────────────────────────────────────────────────

describe("POST /api/discussions/messages/:id/reactions", () => {
  test("400 when emoji missing", async () => {
    const res = await request(teamApp).post("/api/discussions/messages/m1/reactions").send({});
    expect(res.status).toBe(400);
  });

  test("adds reaction and returns updated counts", async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ emoji: "👍", count: "1", user_ids: ["user-1"] }] })
      .mockResolvedValueOnce({ rows: [{ thread_id: "t1" }] });
    const res = await request(teamApp).post("/api/discussions/messages/m1/reactions").send({ emoji: "👍" });
    expect(res.status).toBe(200);
    expect(res.body[0].emoji).toBe("👍");
  });
});

describe("DELETE /api/discussions/messages/:id/reactions/:emoji", () => {
  test("removes reaction and returns updated counts", async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ thread_id: "t1" }] });
    const res = await request(teamApp).delete("/api/discussions/messages/m1/reactions/👍");
    expect(res.status).toBe(200);
  });
});
