import { describe, test, expect } from "@jest/globals";

// pg backend (DATA_BACKEND unset): fileUrl must keep building the Spaces CDN URL
// from the stored bucket key — prod events/discussions images depend on it.
process.env.SPACES_PUBLIC_URL = "https://cdn.example";
delete process.env.KANECTA_FILE_URL_BASE;
delete process.env.KANECTA_API_URL;
delete process.env.DATA_BACKEND;

const { fileUrl } = await import("../lib/spaces.js");
const kanecta = await import("../lib/spacesKanecta.js");

describe("fileUrl (pg backend)", () => {
  test("builds the public CDN URL from the storage key", () => {
    expect(fileUrl({ fileId: "f-1", storageKey: "5c/31/5c318ff4-abcd", mimeType: "image/png" }))
      .toBe("https://cdn.example/5c/31/5c318ff4-abcd");
  });
});

describe("spacesKanecta.fileUrl (no KANECTA_FILE_URL_BASE)", () => {
  test("falls back to the raw kanecta-api blob endpoint with a mime hint", () => {
    expect(kanecta.fileUrl("file-1", "image/png"))
      .toBe("http://127.0.0.1:3001/items/file-1/files/blob?mime=image%2Fpng");
  });

  test("omits the mime query when no mime type is known", () => {
    expect(kanecta.fileUrl("file-1"))
      .toBe("http://127.0.0.1:3001/items/file-1/files/blob");
  });
});
