import { jest, describe, test, expect, afterEach } from "@jest/globals";

const mockVerify = jest.fn();
const mockGetSigningKey = jest.fn((kid, cb) => cb(null, { getPublicKey: () => "key" }));

jest.unstable_mockModule("jsonwebtoken", () => ({ default: { verify: mockVerify } }));
jest.unstable_mockModule("jwks-rsa", () => ({ default: () => ({ getSigningKey: mockGetSigningKey }) }));

const { default: express } = await import("express");
const { default: request } = await import("supertest");
const { requireAuth, requireRole } = await import("../middleware/auth.js");

function makeApp(middleware) {
  const app = express();
  app.get("/test", ...middleware, (req, res) => res.json({ user: req.user }));
  return app;
}

describe("requireAuth", () => {
  afterEach(() => jest.clearAllMocks());

  test("401 when no Authorization header", async () => {
    const res = await request(makeApp([requireAuth])).get("/test");
    expect(res.status).toBe(401);
  });

  test("401 when Authorization header is not Bearer", async () => {
    const res = await request(makeApp([requireAuth])).get("/test").set("Authorization", "Basic abc");
    expect(res.status).toBe(401);
  });

  test("401 when token is invalid", async () => {
    mockVerify.mockImplementation((token, getKey, opts, cb) => cb(new Error("invalid")));
    const res = await request(makeApp([requireAuth])).get("/test").set("Authorization", "Bearer badtoken");
    expect(res.status).toBe(401);
  });

  test("sets req.user from valid token", async () => {
    mockVerify.mockImplementation((token, getKey, opts, cb) =>
      cb(null, { sub: "user-123", given_name: "Jane", family_name: "Smith", realm_access: { roles: ["team"] } })
    );
    const res = await request(makeApp([requireAuth])).get("/test").set("Authorization", "Bearer validtoken");
    expect(res.status).toBe(200);
    expect(res.body.user).toMatchObject({ id: "user-123", name: "Jane Smith", roles: ["team"] });
  });

  test("falls back to preferred_username when name fields missing", async () => {
    mockVerify.mockImplementation((token, getKey, opts, cb) =>
      cb(null, { sub: "u1", preferred_username: "janedoe", realm_access: { roles: [] } })
    );
    const res = await request(makeApp([requireAuth])).get("/test").set("Authorization", "Bearer t");
    expect(res.status).toBe(200);
    expect(res.body.user.name).toBe("janedoe");
  });
});

describe("requireRole", () => {
  function makeAuthedApp(roles, requiredRoles) {
    const app = express();
    app.get("/test",
      (req, res, next) => { req.user = { id: "u1", name: "Test", roles }; next(); },
      requireRole(...requiredRoles),
      (req, res) => res.json({ ok: true })
    );
    return app;
  }

  test("403 when user lacks required role", async () => {
    const res = await request(makeAuthedApp(["local"], ["team"])).get("/test");
    expect(res.status).toBe(403);
  });

  test("passes when user has required role", async () => {
    const res = await request(makeAuthedApp(["team"], ["team"])).get("/test");
    expect(res.status).toBe(200);
  });

  test("passes when user has any of the required roles", async () => {
    const res = await request(makeAuthedApp(["moderator"], ["team", "moderator"])).get("/test");
    expect(res.status).toBe(200);
  });
});
