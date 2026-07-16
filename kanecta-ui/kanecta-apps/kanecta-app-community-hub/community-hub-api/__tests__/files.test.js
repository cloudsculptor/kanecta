import { jest, describe, test, expect, afterEach } from "@jest/globals";
import { Readable } from "stream";

const mockGetFileById = jest.fn();
const mockGetFileStream = jest.fn();

jest.unstable_mockModule("../repositories/files.js", () => ({
  getFileById: mockGetFileById,
}));
jest.unstable_mockModule("../lib/spaces.js", () => ({
  getFileStream: mockGetFileStream,
}));

const { default: express } = await import("express");
const { default: request } = await import("supertest");
const { default: filesRouter } = await import("../routes/files.js");

function makeApp() {
  const app = express();
  app.use("/api/files", filesRouter);
  return app;
}

const app = makeApp();
const FILE_ID = "11111111-2222-3333-4444-555555555555";
afterEach(() => { mockGetFileById.mockReset(); mockGetFileStream.mockReset(); });

// ── GET /api/files/:id ──────────────────────────────────────────────────────────

describe("GET /api/files/:id", () => {
  test("streams the bytes with record headers (public — no auth)", async () => {
    mockGetFileById.mockResolvedValueOnce({
      name: "photo.png", storage_key: FILE_ID, mime_type: "image/png", size_bytes: 4,
    });
    mockGetFileStream.mockResolvedValueOnce({
      Body: Readable.from(Buffer.from("PNG!")), ContentLength: 4,
    });
    const res = await request(app).get(`/api/files/${FILE_ID}`);
    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toBe("image/png");
    expect(res.headers["content-length"]).toBe("4");
    expect(res.headers["content-disposition"]).toBe("inline; filename*=UTF-8''photo.png");
    expect(res.headers["cache-control"]).toContain("immutable");
    expect(res.body.toString()).toBe("PNG!");
    expect(mockGetFileStream).toHaveBeenCalledWith({ storageKey: FILE_ID, mimeType: "image/png" });
  });

  test("streams via the record's storage_key, not the url id (backfilled files)", async () => {
    // A backfilled record still carries the OLD S3 key until the byte migration runs.
    mockGetFileById.mockResolvedValueOnce({
      name: "old.pdf", storage_key: "uploads/ab/cd/legacy-key", mime_type: "application/pdf", size_bytes: 2,
    });
    mockGetFileStream.mockResolvedValueOnce({ Body: Readable.from(Buffer.from("%P")) });
    const res = await request(app).get(`/api/files/${FILE_ID}`);
    expect(res.status).toBe(200);
    expect(mockGetFileStream).toHaveBeenCalledWith({
      storageKey: "uploads/ab/cd/legacy-key", mimeType: "application/pdf",
    });
  });

  test("400 on a non-UUID id", async () => {
    const res = await request(app).get("/api/files/not-a-uuid");
    expect(res.status).toBe(400);
    expect(mockGetFileById).not.toHaveBeenCalled();
  });

  test("404 when the record does not exist", async () => {
    mockGetFileById.mockResolvedValueOnce(undefined);
    const res = await request(app).get(`/api/files/${FILE_ID}`);
    expect(res.status).toBe(404);
    expect(mockGetFileStream).not.toHaveBeenCalled();
  });

  test("404 when the bytes are missing (NoSuchKey)", async () => {
    mockGetFileById.mockResolvedValueOnce({
      name: "gone.png", storage_key: FILE_ID, mime_type: "image/png",
    });
    const err = new Error("File bytes not found");
    err.code = "NoSuchKey";
    mockGetFileStream.mockRejectedValueOnce(err);
    const res = await request(app).get(`/api/files/${FILE_ID}`);
    expect(res.status).toBe(404);
  });

  test("500 on an unexpected stream error", async () => {
    mockGetFileById.mockResolvedValueOnce({
      name: "x.png", storage_key: FILE_ID, mime_type: "image/png",
    });
    mockGetFileStream.mockRejectedValueOnce(new Error("boom"));
    const res = await request(app).get(`/api/files/${FILE_ID}`);
    expect(res.status).toBe(500);
  });
});
