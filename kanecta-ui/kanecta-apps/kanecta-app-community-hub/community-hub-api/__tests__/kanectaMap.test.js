import { describe, test, expect } from "@jest/globals";
import { camelKey, coerceRow, selectionFor } from "../lib/kanectaMap.js";

// ── camelKey ─────────────────────────────────────────────────────────────────

describe("camelKey", () => {
  test("converts snake_case to camelCase", () => {
    expect(camelKey("foo_bar")).toBe("fooBar");
    expect(camelKey("sort_order")).toBe("sortOrder");
  });

  test("converts multiple underscores", () => {
    expect(camelKey("created_by_name")).toBe("createdByName");
  });

  test("leaves a field with no underscore unchanged", () => {
    expect(camelKey("id")).toBe("id");
    expect(camelKey("title")).toBe("title");
  });

  test("handles a digit after an underscore", () => {
    expect(camelKey("field_1_name")).toBe("field1Name");
  });

  test("leading underscore has no letter/digit before consumption boundary", () => {
    // The regex only matches _[a-z0-9]; a trailing underscore with nothing after
    // it is left as-is.
    expect(camelKey("trailing_")).toBe("trailing_");
  });
});

// ── coerce (exercised via coerceRow) ────────────────────────────────────────

describe("coerceRow", () => {
  test("passes through text/id/int/bool kinds unchanged", () => {
    const gqlRow = { id: "abc", name: "Featherston", sortOrder: 3, public: true };
    const spec = [["id", "id"], ["name", "text"], ["sort_order", "int"], ["public", "bool"]];
    expect(coerceRow(gqlRow, spec)).toEqual({ id: "abc", name: "Featherston", sort_order: 3, public: true });
  });

  test("a column absent from the GraphQL row yields undefined", () => {
    const gqlRow = { id: "abc" };
    const spec = [["id", "id"], ["name", "text"]];
    expect(coerceRow(gqlRow, spec)).toEqual({ id: "abc", name: undefined });
  });

  test("null passes through untouched for every kind", () => {
    const gqlRow = {
      money: null, floatVal: null, dateVal: null, timestampVal: null, refVal: null, jsonVal: null,
    };
    const spec = [
      ["money", "money"], ["float_val", "float"], ["date_val", "date"],
      ["timestamp_val", "timestamp"], ["ref_val", "ref"], ["json_val", "json"],
    ];
    const out = coerceRow(gqlRow, spec);
    expect(out).toEqual({
      money: null, float_val: null, date_val: null, timestamp_val: null, ref_val: null, json_val: null,
    });
  });

  test("money is fixed to 2 decimal places, from a GraphQL number", () => {
    const gqlRow = { amount: 45.4 };
    const spec = [["amount", "money"]];
    expect(coerceRow(gqlRow, spec)).toEqual({ amount: "45.40" });
  });

  test("money rounds/handles integers and strings the same way", () => {
    expect(coerceRow({ amount: 10 }, [["amount", "money"]])).toEqual({ amount: "10.00" });
    expect(coerceRow({ amount: "12.5" }, [["amount", "money"]])).toEqual({ amount: "12.50" });
  });

  test("float passes through as a JS number (lat/lng passthrough)", () => {
    const gqlRow = { lat: -41.1 };
    const spec = [["lat", "float"]];
    expect(coerceRow(gqlRow, spec)).toEqual({ lat: -41.1 });
  });

  test("float coerces a numeric string to a number", () => {
    const gqlRow = { lat: "-41.1" };
    const spec = [["lat", "float"]];
    expect(coerceRow(gqlRow, spec)).toEqual({ lat: -41.1 });
  });

  test("date takes the local calendar date off a full timestamp", () => {
    const gqlRow = { eventDate: "2026-07-17T00:00:00+12:00" };
    const spec = [["event_date", "date"]];
    expect(coerceRow(gqlRow, spec)).toEqual({ event_date: "2026-07-17" });
  });

  test("timestamp re-normalises an offset ISO string to UTC Z form", () => {
    const gqlRow = { createdAt: "2026-07-17T12:00:00+12:00" };
    const spec = [["created_at", "timestamp"]];
    // +12:00 local noon => 00:00 UTC same day.
    expect(coerceRow(gqlRow, spec)).toEqual({ created_at: "2026-07-17T00:00:00.000Z" });
  });

  test("ref unwraps a resolved { id } object back to the scalar id", () => {
    const gqlRow = { licenceId: { id: "lic-1" } };
    const spec = [["licence_id", "ref"]];
    expect(coerceRow(gqlRow, spec)).toEqual({ licence_id: "lic-1" });
  });

  test("ref yields null when the resolved reference is null", () => {
    const gqlRow = { licenceId: null };
    const spec = [["licence_id", "ref"]];
    expect(coerceRow(gqlRow, spec)).toEqual({ licence_id: null });
  });

  test("json parses a JSON-encoded string back to an object", () => {
    const gqlRow = { contentJson: JSON.stringify({ root: { children: [] } }) };
    const spec = [["content_json", "json"]];
    expect(coerceRow(gqlRow, spec)).toEqual({ content_json: { root: { children: [] } } });
  });

  test("json passes through an already-parsed object unchanged", () => {
    const obj = { root: { children: [] } };
    const gqlRow = { contentJson: obj };
    const spec = [["content_json", "json"]];
    expect(coerceRow(gqlRow, spec)).toEqual({ content_json: obj });
  });

  test("preserves the spec's column order in the output object's key order", () => {
    const gqlRow = { b: 2, a: 1 };
    const spec = [["b", "int"], ["a", "int"]];
    expect(Object.keys(coerceRow(gqlRow, spec))).toEqual(["b", "a"]);
  });
});

// ── selectionFor ─────────────────────────────────────────────────────────────

describe("selectionFor", () => {
  test("builds a space-separated camelCase field list", () => {
    const spec = [["id", "id"], ["name", "text"], ["sort_order", "int"]];
    expect(selectionFor(spec)).toBe("id name sortOrder");
  });

  test("expands a ref field to a sub-selection of { id }", () => {
    const spec = [["id", "id"], ["licence_id", "ref"]];
    expect(selectionFor(spec)).toBe("id licenceId { id }");
  });

  test("empty spec yields an empty string", () => {
    expect(selectionFor([])).toBe("");
  });

  test("round-trip: selectionFor's fields match coerceRow's expected keys", () => {
    const spec = [
      ["id", "id"], ["created_by_name", "text"], ["licence_id", "ref"], ["created_at", "timestamp"],
    ];
    const selection = selectionFor(spec);
    expect(selection).toBe("id createdByName licenceId { id } createdAt");
    // Simulate what a GraphQL server would return for that selection set, then
    // confirm coerceRow maps it straight back to the snake_case spec columns.
    const gqlRow = {
      id: "p1", createdByName: "Jane", licenceId: { id: "lic-9" }, createdAt: "2026-07-17T00:00:00.000Z",
    };
    expect(coerceRow(gqlRow, spec)).toEqual({
      id: "p1", created_by_name: "Jane", licence_id: "lic-9", created_at: "2026-07-17T00:00:00.000Z",
    });
  });
});
