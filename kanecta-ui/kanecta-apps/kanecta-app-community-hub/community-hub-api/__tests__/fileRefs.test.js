import { describe, test, expect, beforeEach } from "@jest/globals";
import { fileIdFromUrl } from "../lib/fileRefs.js";

const ID = "5c318ff4-15e1-432b-b78e-7e3281d6a4aa";

beforeEach(() => {
  process.env.SPACES_PUBLIC_URL = "https://cdn.example";
  process.env.KANECTA_FILE_URL_BASE = "https://test.example/api/files";
  process.env.KANECTA_API_URL = "http://127.0.0.1:3001";
});

describe("fileIdFromUrl", () => {
  test("CDN sharded key (post migrate-storage-keys)", () => {
    expect(fileIdFromUrl(`https://cdn.example/5c/31/${ID}`)).toBe(ID);
  });

  test("CDN flat key (pre-shard prod uploads)", () => {
    expect(fileIdFromUrl(`https://cdn.example/${ID}`)).toBe(ID);
  });

  test("community-hub file proxy (kanecta uploads)", () => {
    expect(fileIdFromUrl(`https://test.example/api/files/${ID}`)).toBe(ID);
  });

  test("raw kanecta-api blob endpoint, with mime query", () => {
    expect(fileIdFromUrl(`http://127.0.0.1:3001/items/${ID}/files/blob?mime=image%2Fpng`)).toBe(ID);
  });

  test("foreign URLs never match, even when they contain a UUID", () => {
    expect(fileIdFromUrl(`https://evil.example/api/files/${ID}`)).toBeNull();
    expect(fileIdFromUrl(`https://other-cdn.example/5c/31/${ID}`)).toBeNull();
  });

  test("app-prefixed URLs without a UUID segment yield null", () => {
    expect(fileIdFromUrl("https://cdn.example/logo.png")).toBeNull();
    expect(fileIdFromUrl("https://cdn.example/")).toBeNull();
  });

  test("non-strings and empties yield null", () => {
    expect(fileIdFromUrl(undefined)).toBeNull();
    expect(fileIdFromUrl(null)).toBeNull();
    expect(fileIdFromUrl("")).toBeNull();
  });

  test("unset env prefixes are simply not matched", () => {
    delete process.env.KANECTA_FILE_URL_BASE;
    expect(fileIdFromUrl(`https://test.example/api/files/${ID}`)).toBeNull();
    expect(fileIdFromUrl(`https://cdn.example/5c/31/${ID}`)).toBe(ID);
  });
});
