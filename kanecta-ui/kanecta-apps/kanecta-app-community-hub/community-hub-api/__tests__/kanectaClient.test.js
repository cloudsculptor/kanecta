import { jest, describe, test, expect, afterEach } from "@jest/globals";

const mockFetch = jest.fn();
global.fetch = mockFetch;

// kanectaClient.js reads KANECTA_API_URL at module-load time (`const BASE = ...`),
// so it must be set before the module is imported.
process.env.KANECTA_API_URL = "http://test-kanecta:9999";

const {
  graphql, createItem, getItem, deleteItem, transaction, updateObject,
  putFile, getFile, deleteFileBytes, resolveTypeId, newId, apiBase, ROOT_ID, OWNER,
} = await import("../lib/kanectaClient.js");

afterEach(() => mockFetch.mockReset());

// Build a fetch Response-shaped mock. `body` is the raw text payload.
function textRes(status, body, { ok } = {}) {
  return { ok: ok ?? (status >= 200 && status < 300), status, text: async () => body };
}
function jsonRes(status, obj) {
  return textRes(status, JSON.stringify(obj));
}

describe("apiBase / newId", () => {
  test("apiBase returns the configured KANECTA_API_URL", () => {
    expect(apiBase()).toBe("http://test-kanecta:9999");
  });

  test("newId returns a distinct UUID each call", () => {
    const a = newId();
    const b = newId();
    expect(a).not.toBe(b);
    expect(a).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);
  });
});

// ── request building (via createItem/getItem/deleteItem, the thin req() wrapper) ──

describe("request building", () => {
  test("POST with a body sends JSON content-type header and a stringified body", async () => {
    mockFetch.mockResolvedValueOnce(jsonRes(200, { id: "item-1" }));
    await createItem({ type: "object", value: "x" });
    expect(mockFetch).toHaveBeenCalledWith("http://test-kanecta:9999/items", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ type: "object", value: "x" }),
    });
  });

  test("GET with no body sends no headers and no body", async () => {
    mockFetch.mockResolvedValueOnce(jsonRes(200, { id: "item-1" }));
    await getItem("item-1");
    expect(mockFetch).toHaveBeenCalledWith("http://test-kanecta:9999/items/item-1", {
      method: "GET",
      headers: {},
      body: undefined,
    });
  });

  test("DELETE without force omits the query string", async () => {
    mockFetch.mockResolvedValueOnce(jsonRes(200, {}));
    await deleteItem("item-1");
    expect(mockFetch.mock.calls[0][0]).toBe("http://test-kanecta:9999/items/item-1");
  });

  test("DELETE with force appends ?force=true", async () => {
    mockFetch.mockResolvedValueOnce(jsonRes(200, {}));
    await deleteItem("item-1", { force: true });
    expect(mockFetch.mock.calls[0][0]).toBe("http://test-kanecta:9999/items/item-1?force=true");
  });

  test("an empty response body parses to {}", async () => {
    mockFetch.mockResolvedValueOnce(textRes(200, ""));
    const result = await getItem("item-1");
    expect(result).toEqual({});
  });
});

// ── error propagation ────────────────────────────────────────────────────────

describe("error propagation", () => {
  test("throws with status and JSON body on a non-2xx response (a call that doesn't special-case 404)", async () => {
    mockFetch.mockResolvedValueOnce(jsonRes(400, { error: "bad request" }));
    await expect(createItem({ type: "object" })).rejects.toThrow(/kanecta-api \/items 400/);
  });

  test("getItem swallows a 404 specifically and returns null", async () => {
    mockFetch.mockResolvedValueOnce(jsonRes(404, { error: "not found" }));
    const result = await getItem("missing");
    expect(result).toBeNull();
  });

  test("getItem re-throws a non-404 error", async () => {
    mockFetch.mockResolvedValueOnce(jsonRes(500, { error: "boom" }));
    await expect(getItem("x")).rejects.toThrow(/500/);
  });

  test("throws a distinct error for a non-JSON response body", async () => {
    mockFetch.mockResolvedValueOnce(textRes(502, "<html>Bad Gateway</html>"));
    await expect(getItem("x")).rejects.toThrow(/non-JSON response \(502\)/);
  });

  test("graphql throws on a GraphQL errors envelope even with HTTP 200", async () => {
    mockFetch.mockResolvedValueOnce(jsonRes(200, { errors: [{ message: "bad field" }] }));
    await expect(graphql("{ pageses { id } }")).rejects.toThrow(/kanecta graphql/);
  });

  test("graphql returns the data object when there are no errors", async () => {
    mockFetch.mockResolvedValueOnce(jsonRes(200, { data: { pageses: [{ id: "p1" }] } }));
    const data = await graphql("{ pageses { id } }", { foo: "bar" });
    expect(data).toEqual({ pageses: [{ id: "p1" }] });
    expect(mockFetch).toHaveBeenCalledWith("http://test-kanecta:9999/graphql", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ query: "{ pageses { id } }", variables: { foo: "bar" } }),
    });
  });
});

// ── writes: createItem / transaction / updateObject ─────────────────────────

describe("writes", () => {
  test("createItem POSTs the body as-is to /items", async () => {
    mockFetch.mockResolvedValueOnce(jsonRes(200, { id: "new-1" }));
    const body = { type: "object", value: "pages", parentId: ROOT_ID, owner: OWNER };
    const result = await createItem(body);
    expect(result).toEqual({ id: "new-1" });
    const [url, opts] = mockFetch.mock.calls[0];
    expect(url).toBe("http://test-kanecta:9999/items");
    expect(JSON.parse(opts.body)).toEqual(body);
  });

  test("transaction POSTs { ops } to /transaction", async () => {
    mockFetch.mockResolvedValueOnce(jsonRes(200, { ok: true }));
    const ops = [{ op: "create", id: "1" }, { op: "delete", id: "2" }];
    await transaction(ops);
    const [url, opts] = mockFetch.mock.calls[0];
    expect(url).toBe("http://test-kanecta:9999/transaction");
    expect(JSON.parse(opts.body)).toEqual({ ops });
  });

  test("updateObject wraps a single update op in a transaction", async () => {
    mockFetch.mockResolvedValueOnce(jsonRes(200, { ok: true }));
    await updateObject("item-1", { name: "x" });
    const [url, opts] = mockFetch.mock.calls[0];
    expect(url).toBe("http://test-kanecta:9999/transaction");
    expect(JSON.parse(opts.body)).toEqual({
      ops: [{ op: "update", id: "item-1", changes: { objectData: { name: "x" } } }],
    });
  });
});

// ── file bytes: putFile / getFile / deleteFileBytes ─────────────────────────

describe("file bytes", () => {
  test("putFile POSTs raw bytes with the given mime type to the blob endpoint", async () => {
    mockFetch.mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ ok: true }) });
    const buf = Buffer.from("hello");
    await putFile("file-1", buf, "text/plain");
    expect(mockFetch).toHaveBeenCalledWith("http://test-kanecta:9999/items/file-1/files/blob", {
      method: "POST",
      headers: { "content-type": "text/plain" },
      body: buf,
    });
  });

  test("putFile defaults to application/octet-stream when no mime type given", async () => {
    mockFetch.mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ ok: true }) });
    await putFile("file-1", Buffer.from("x"), undefined);
    expect(mockFetch.mock.calls[0][1].headers).toEqual({ "content-type": "application/octet-stream" });
  });

  test("putFile throws on a non-ok response", async () => {
    mockFetch.mockResolvedValueOnce({ ok: false, status: 500, text: async () => "boom" });
    await expect(putFile("file-1", Buffer.from("x"), "text/plain")).rejects.toThrow(/putFile file-1 500/);
  });

  // Copy a string to a right-sized ArrayBuffer (Buffer.from(string).buffer can be
  // backed by Node's larger internal pool, which would corrupt a naive .buffer read).
  function arrayBufferOf(str) {
    return new TextEncoder().encode(str).buffer;
  }

  test("getFile appends ?mime= when a mime type is supplied", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true, status: 200, arrayBuffer: async () => arrayBufferOf("data"),
    });
    await getFile("file-1", "image/png");
    expect(mockFetch).toHaveBeenCalledWith("http://test-kanecta:9999/items/file-1/files/blob?mime=image%2Fpng");
  });

  test("getFile omits the query string when no mime type is supplied", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true, status: 200, arrayBuffer: async () => arrayBufferOf("data"),
    });
    await getFile("file-1");
    expect(mockFetch).toHaveBeenCalledWith("http://test-kanecta:9999/items/file-1/files/blob");
  });

  test("getFile returns a Buffer of the bytes on success", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true, status: 200, arrayBuffer: async () => arrayBufferOf("hello"),
    });
    const result = await getFile("file-1");
    expect(Buffer.isBuffer(result)).toBe(true);
    expect(result.toString()).toBe("hello");
  });

  test("getFile returns null on a 404", async () => {
    mockFetch.mockResolvedValueOnce({ ok: false, status: 404 });
    const result = await getFile("missing");
    expect(result).toBeNull();
  });

  test("getFile throws on a non-404 error status", async () => {
    mockFetch.mockResolvedValueOnce({ ok: false, status: 500 });
    await expect(getFile("file-1")).rejects.toThrow(/getFile file-1 500/);
  });

  test("deleteFileBytes DELETEs the blob endpoint", async () => {
    mockFetch.mockResolvedValueOnce({ ok: true, status: 204 });
    await deleteFileBytes("file-1");
    expect(mockFetch).toHaveBeenCalledWith("http://test-kanecta:9999/items/file-1/files/blob", { method: "DELETE" });
  });

  test("deleteFileBytes is idempotent — does not throw on a 404", async () => {
    mockFetch.mockResolvedValueOnce({ ok: false, status: 404 });
    await expect(deleteFileBytes("missing")).resolves.toBeUndefined();
  });

  test("deleteFileBytes throws on a non-404 error status", async () => {
    mockFetch.mockResolvedValueOnce({ ok: false, status: 500 });
    await expect(deleteFileBytes("file-1")).rejects.toThrow(/deleteFile file-1 500/);
  });
});

// ── resolveTypeId caching ─────────────────────────────────────────────────────
// _typesCache is module-level state (a top-level `let`), populated once from
// GET /types and never invalidated for the lifetime of the process. These two
// tests are intentionally sequential (sharing that module-level cache) to
// document the real behaviour: only the FIRST resolveTypeId call anywhere in
// the process ever hits the network.

describe("resolveTypeId", () => {
  test("fetches /types once and resolves multiple type names from the cache", async () => {
    mockFetch.mockResolvedValueOnce(
      jsonRes(200, [{ value: "pages", id: "type-pages" }, { value: "files", id: "type-files" }]),
    );
    const pagesId = await resolveTypeId("pages");
    const filesId = await resolveTypeId("files"); // served from cache — no 2nd fetch
    expect(pagesId).toBe("type-pages");
    expect(filesId).toBe("type-files");
    expect(mockFetch).toHaveBeenCalledTimes(1);
    expect(mockFetch).toHaveBeenCalledWith("http://test-kanecta:9999/types", { method: "GET", headers: {}, body: undefined });
  });

  test("throws for a type name absent from the (already-cached) type list", async () => {
    await expect(resolveTypeId("no-such-type")).rejects.toThrow(/no type named "no-such-type"/);
    // No additional fetch — the cache from the previous test satisfied this lookup.
    expect(mockFetch).toHaveBeenCalledTimes(0);
  });
});
