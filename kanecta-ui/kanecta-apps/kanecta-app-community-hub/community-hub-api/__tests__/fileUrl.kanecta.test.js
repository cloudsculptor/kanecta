import { jest, describe, test, expect } from "@jest/globals";

// kanecta backend: fileUrl must route through the file proxy, NOT the Spaces CDN.
// Under kanecta the storage_key is the file ITEM id and the bytes live in
// Kanecta's object store — a `${SPACES_PUBLIC_URL}/${storage_key}` URL 403s
// (the events-images bug this guards against).
process.env.SPACES_PUBLIC_URL = "https://cdn.example";
process.env.KANECTA_FILE_URL_BASE = "https://test.example/api/files";

jest.unstable_mockModule("../repositories/backend.js", () => ({ USE_KANECTA: true }));

const { fileUrl } = await import("../lib/spaces.js");

describe("fileUrl (kanecta backend)", () => {
  test("builds the file-proxy URL from the file id, ignoring the CDN", () => {
    expect(fileUrl({ fileId: "file-1", storageKey: "file-1", mimeType: "image/png" }))
      .toBe("https://test.example/api/files/file-1");
  });

  test("falls back to storage_key as the id when file_id is absent (kanecta storage_key IS the item id)", () => {
    expect(fileUrl({ storageKey: "file-2" }))
      .toBe("https://test.example/api/files/file-2");
  });
});
