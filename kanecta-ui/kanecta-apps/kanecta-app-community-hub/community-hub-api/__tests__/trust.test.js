import { jest, describe, test, expect, afterEach } from "@jest/globals";

const mockGetEndorsementFor = jest.fn();
const mockIsEndorsed = jest.fn();
const mockAdminFetch = jest.fn();

jest.unstable_mockModule("../middleware/auth.js", () => ({
  requireAuth: (req, res, next) => next(),
}));
jest.unstable_mockModule("../lib/keycloakAdmin.js", () => ({ adminFetch: mockAdminFetch }));
jest.unstable_mockModule("../repositories/trust.js", () => ({
  getEndorsementFor: mockGetEndorsementFor,
  isEndorsed: mockIsEndorsed,
}));

const { default: express } = await import("express");
const { default: request } = await import("supertest");
const { default: trustRouter } = await import("../routes/trust.js");

const app = express();
app.use((req, res, next) => {
  req.user = { id: "user-1", name: "Jane Smith", roles: ["team"] };
  next();
});
app.use("/api/trust", trustRouter);

afterEach(() => {
  mockGetEndorsementFor.mockReset();
  mockIsEndorsed.mockReset();
  mockAdminFetch.mockReset();
});

// The simplest chain: the root Administrator endorsed user-1, so the chain is
// [Administrator, user-1] and the last node is the one whose name gets resolved.
function chainOfTwo() {
  mockGetEndorsementFor.mockImplementation(async (id) =>
    id === "user-1" ? { endorsed_by_id: "root-1", know_personally: true } : null
  );
  mockIsEndorsed.mockResolvedValue(false);
}

function keycloakError(status) {
  const err = new Error(`Keycloak admin API error (${status}): boom`);
  err.status = status;
  return err;
}

describe("GET /api/trust/my-chain — name resolution", () => {
  test("shows a member whose account was deleted as 'Former member'", async () => {
    chainOfTwo();
    mockAdminFetch.mockImplementation(async (path) => {
      if (path === "/users/user-1") throw keycloakError(404);
      return { firstName: "Root", lastName: "Admin" };
    });

    const res = await request(app).get("/api/trust/my-chain");

    expect(res.status).toBe(200);
    expect(res.body.at(-1).name).toBe("Former member");
  });

  test("does not label a live member 'Former member' when Keycloak is down", async () => {
    chainOfTwo();
    mockAdminFetch.mockImplementation(async () => {
      throw keycloakError(503);
    });

    const res = await request(app).get("/api/trust/my-chain");

    expect(res.status).toBe(200);
    expect(res.body.at(-1).name).toBe("Unknown");
  });

  test("uses the member's real name when Keycloak answers", async () => {
    chainOfTwo();
    mockAdminFetch.mockResolvedValue({ firstName: "Jane", lastName: "Smith" });

    const res = await request(app).get("/api/trust/my-chain");

    expect(res.status).toBe(200);
    expect(res.body.at(-1).name).toBe("Jane Smith");
  });
});
