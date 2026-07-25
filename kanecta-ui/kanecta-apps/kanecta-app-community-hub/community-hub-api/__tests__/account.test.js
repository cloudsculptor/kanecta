import { jest, describe, test, expect, afterEach } from "@jest/globals";

const mockQuery = jest.fn();
const mockClientQuery = jest.fn();
const mockRelease = jest.fn();
const mockConnect = jest.fn(() => ({ query: mockClientQuery, release: mockRelease }));
const mockAdminFetch = jest.fn();

jest.unstable_mockModule("../db.js", () => ({ default: { query: mockQuery, connect: mockConnect } }));
jest.unstable_mockModule("../middleware/auth.js", () => ({
  requireAuth: (req, res, next) => next(),
}));
jest.unstable_mockModule("../lib/keycloakAdmin.js", () => ({ adminFetch: mockAdminFetch }));

const { default: express } = await import("express");
const { default: request } = await import("supertest");
const { default: accountRouter } = await import("../routes/account.js");

function makeApp() {
  const app = express();
  app.use(express.json());
  app.use((req, res, next) => {
    req.user = { id: "user-1", name: "Jane Smith", roles: ["team"] };
    next();
  });
  app.use("/api/account", accountRouter);
  return app;
}

const app = makeApp();
afterEach(() => {
  mockQuery.mockReset();
  mockClientQuery.mockReset();
  mockRelease.mockReset();
  mockConnect.mockClear();
  mockAdminFetch.mockReset();
});

// ── GET /api/account/deletion-preview ───────────────────────────────────────

describe("GET /api/account/deletion-preview", () => {
  test("returns the user's upcoming events", async () => {
    const events = [{ id: "e1", title: "Market Day", start_date: "2026-08-01" }];
    mockQuery.mockResolvedValueOnce({ rows: events });
    const res = await request(app).get("/api/account/deletion-preview");
    expect(res.status).toBe(200);
    expect(res.body.upcomingEvents).toEqual(events);
    expect(mockQuery.mock.calls[0][1][0]).toBe("user-1");
  });

  test("500 on DB error", async () => {
    mockQuery.mockRejectedValueOnce(new Error("db down"));
    const res = await request(app).get("/api/account/deletion-preview");
    expect(res.status).toBe(500);
  });
});

// ── DELETE /api/account/me ──────────────────────────────────────────────────

describe("DELETE /api/account/me", () => {
  test("anonymises content, deletes personal rows, then deletes the Keycloak user", async () => {
    mockClientQuery.mockResolvedValue({ rows: [] });
    mockAdminFetch.mockResolvedValueOnce(null);

    const res = await request(app).delete("/api/account/me");

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(mockClientQuery).toHaveBeenCalledWith("BEGIN");
    expect(mockClientQuery).toHaveBeenCalledWith("COMMIT");
    expect(mockRelease).toHaveBeenCalled();
    expect(mockAdminFetch).toHaveBeenCalledWith("/users/user-1", { method: "DELETE" });

    const updatedEvents = mockClientQuery.mock.calls.some(
      ([sql]) => sql.includes("UPDATE events SET deleted_at = NOW()")
    );
    expect(updatedEvents).toBe(true);
  });

  test("rolls back and does not delete the Keycloak user if a DB step fails", async () => {
    mockClientQuery.mockImplementation((sql) => {
      if (sql === "BEGIN") return Promise.resolve();
      if (typeof sql === "string" && sql.startsWith("UPDATE events SET deleted_at")) {
        return Promise.reject(new Error("db down"));
      }
      return Promise.resolve({ rows: [] });
    });

    const res = await request(app).delete("/api/account/me");

    expect(res.status).toBe(500);
    expect(mockClientQuery).toHaveBeenCalledWith("ROLLBACK");
    expect(mockRelease).toHaveBeenCalled();
    expect(mockAdminFetch).not.toHaveBeenCalled();
  });
});
