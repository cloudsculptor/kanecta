import { jest, describe, test, expect, afterEach } from "@jest/globals";

const mockCreateItem = jest.fn();
const mockDeleteItem = jest.fn();
const mockPutFile = jest.fn();
const mockGetFile = jest.fn();
const mockDeleteFileBytes = jest.fn();
const mockResolveTypeId = jest.fn();
const mockNewId = jest.fn();

jest.unstable_mockModule("../lib/kanectaClient.js", () => ({
  createItem: mockCreateItem,
  deleteItem: mockDeleteItem,
  putFile: mockPutFile,
  getFile: mockGetFile,
  deleteFileBytes: mockDeleteFileBytes,
  resolveTypeId: mockResolveTypeId,
  newId: mockNewId,
  ROOT_ID: "00000000-0000-0000-0000-000000000000",
  OWNER: "community-hub",
}));

const { uploadFile, deleteFile, getFileStream } = await import("../lib/spacesKanecta.js");

afterEach(() => {
  mockCreateItem.mockReset();
  mockDeleteItem.mockReset();
  mockPutFile.mockReset();
  mockGetFile.mockReset();
  mockDeleteFileBytes.mockReset();
  mockResolveTypeId.mockReset();
  mockNewId.mockReset();
});

// ── uploadFile ────────────────────────────────────────────────────────────────

describe("uploadFile", () => {
  test("writes the bytes before the record, then creates the item under ROOT_ID/OWNER", async () => {
    mockResolveTypeId.mockResolvedValueOnce("type-files");
    mockNewId.mockReturnValueOnce("file-1");
    mockPutFile.mockResolvedValueOnce({});
    mockCreateItem.mockResolvedValueOnce({ id: "file-1" });

    const buffer = Buffer.from("hello world");
    const result = await uploadFile({
      buffer, mimeType: "text/plain", originalName: "hello.txt",
      uploadedById: "user-1", uploadedByName: "Jane",
    });

    // bytes go first
    expect(mockPutFile).toHaveBeenCalledWith("file-1", buffer, "text/plain");
    const putFileOrder = mockPutFile.mock.invocationCallOrder[0];
    const createItemOrder = mockCreateItem.mock.invocationCallOrder[0];
    expect(putFileOrder).toBeLessThan(createItemOrder);

    expect(mockCreateItem).toHaveBeenCalledWith({
      id: "file-1", type: "object", typeId: "type-files",
      parentId: "00000000-0000-0000-0000-000000000000", owner: "community-hub",
      objectData: expect.objectContaining({
        name: "hello.txt", storageKey: "file-1", mimeType: "text/plain", sizeBytes: buffer.length,
        description: null, uploadedById: "user-1", uploadedByName: "Jane", deletedAt: null,
      }),
    });

    expect(result.file).toEqual({
      id: "file-1", name: "hello.txt", storage_key: "file-1", mime_type: "text/plain",
      size_bytes: buffer.length, uploaded_by_id: "user-1", uploaded_by_name: "Jane",
    });
    // default URL base: KANECTA_API_URL/items/:id/files/blob
    expect(result.url).toBe("http://127.0.0.1:3001/items/file-1/files/blob?mime=text%2Fplain");
  });

  test("rolls back the bytes if the record write fails, then rethrows", async () => {
    mockResolveTypeId.mockResolvedValueOnce("type-files");
    mockNewId.mockReturnValueOnce("file-2");
    mockPutFile.mockResolvedValueOnce({});
    const err = new Error("create failed");
    mockCreateItem.mockRejectedValueOnce(err);
    mockDeleteFileBytes.mockResolvedValueOnce(undefined);

    await expect(uploadFile({
      buffer: Buffer.from("x"), mimeType: "text/plain", originalName: "x.txt",
      uploadedById: "u1", uploadedByName: "U",
    })).rejects.toThrow("create failed");

    expect(mockDeleteFileBytes).toHaveBeenCalledWith("file-2");
  });

  test("swallows a failure during byte rollback (best-effort) and still rethrows the original error", async () => {
    mockResolveTypeId.mockResolvedValueOnce("type-files");
    mockNewId.mockReturnValueOnce("file-3");
    mockPutFile.mockResolvedValueOnce({});
    mockCreateItem.mockRejectedValueOnce(new Error("create failed"));
    mockDeleteFileBytes.mockRejectedValueOnce(new Error("rollback also failed"));

    await expect(uploadFile({
      buffer: Buffer.from("x"), mimeType: "text/plain", originalName: "x.txt",
      uploadedById: "u1", uploadedByName: "U",
    })).rejects.toThrow("create failed");
  });
});

// ── deleteFile ────────────────────────────────────────────────────────────────

describe("deleteFile", () => {
  test("prefers fileId over storageKey when both are given", async () => {
    mockDeleteFileBytes.mockResolvedValueOnce(undefined);
    mockDeleteItem.mockResolvedValueOnce(undefined);
    await deleteFile({ storageKey: "legacy-key", fileId: "file-1" });
    expect(mockDeleteFileBytes).toHaveBeenCalledWith("file-1");
    expect(mockDeleteItem).toHaveBeenCalledWith("file-1", { force: true });
  });

  test("falls back to storageKey when fileId is absent", async () => {
    mockDeleteFileBytes.mockResolvedValueOnce(undefined);
    mockDeleteItem.mockResolvedValueOnce(undefined);
    await deleteFile({ storageKey: "file-9" });
    expect(mockDeleteFileBytes).toHaveBeenCalledWith("file-9");
    expect(mockDeleteItem).toHaveBeenCalledWith("file-9", { force: true });
  });

  test("is best-effort — does not throw when the byte delete rejects", async () => {
    mockDeleteFileBytes.mockRejectedValueOnce(new Error("bytes gone"));
    mockDeleteItem.mockResolvedValueOnce(undefined);
    await expect(deleteFile({ fileId: "file-1" })).resolves.toBeUndefined();
    expect(mockDeleteItem).toHaveBeenCalledWith("file-1", { force: true });
  });

  test("is best-effort — does not throw when the item delete rejects", async () => {
    mockDeleteFileBytes.mockResolvedValueOnce(undefined);
    mockDeleteItem.mockRejectedValueOnce(new Error("item gone"));
    await expect(deleteFile({ fileId: "file-1" })).resolves.toBeUndefined();
  });
});

// ── getFileStream ─────────────────────────────────────────────────────────────

describe("getFileStream", () => {
  test("returns a Readable wrapping the bytes, with content type/length", async () => {
    const buf = Buffer.from("file bytes");
    mockGetFile.mockResolvedValueOnce(buf);
    const result = await getFileStream({ storageKey: "file-1", mimeType: "text/plain" });
    expect(result.ContentType).toBe("text/plain");
    expect(result.ContentLength).toBe(buf.length);
    const chunks = [];
    for await (const chunk of result.Body) chunks.push(chunk);
    expect(Buffer.concat(chunks).toString()).toBe("file bytes");
    expect(mockGetFile).toHaveBeenCalledWith("file-1", "text/plain");
  });

  test("throws a NoSuchKey-coded error when the bytes are missing", async () => {
    mockGetFile.mockResolvedValueOnce(null);
    await expect(getFileStream({ storageKey: "missing" })).rejects.toMatchObject({
      code: "NoSuchKey", message: "File bytes not found",
    });
  });
});
