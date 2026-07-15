// Field-shape translation between the Kanecta wire format (camelCase GraphQL) and
// the row shape the community-hub routes/frontend expect (snake_case, matching the
// original featherston SQL columns) — plus the representation coercions the Phase B
// shadow-diff surfaced, so the Kanecta read path reproduces the pg driver's output
// byte-for-byte in the JSON response:
//
//   * NUMERIC/DECIMAL — pg returns a string ("45.42"); GraphQL returns a JS number.
//     `money` fixes the scale to 2 (finances columns are NUMERIC(10,2)).
//   * DATE — pg (via db.js's 1082 type parser) returns a bare 'YYYY-MM-DD'; the
//     backfill stored it as timestamptz, so GraphQL returns a full local-offset
//     timestamp. `date` takes the local calendar date back off it.
//   * TIMESTAMP — pg returns a Date → JSON serialises to UTC ISO with a trailing Z;
//     GraphQL returns the same instant with a +NN:NN offset. `timestamp`
//     re-normalises to the identical UTC ISO string.

// snake_case → camelCase: foo_bar -> fooBar (GraphQL field lookup).
export function camelKey(k) {
  return k.replace(/_([a-z0-9])/g, (_, c) => c.toUpperCase());
}

function coerce(value, kind) {
  if (value == null) return value;
  switch (kind) {
    case "money":     return Number(value).toFixed(2);
    case "date":      return String(value).slice(0, 10);
    case "timestamp": return new Date(value).toISOString();
    // A backfilled FK column is exposed as a RESOLVED reference object in GraphQL
    // (its typeId points at the target type), not a scalar. The source column held
    // the raw target id, so unwrap `{ id }` back to that scalar.
    case "ref":       return value.id ?? null;
    // A jsonb source column projects to a STRING property in GraphQL (stored
    // JSON-encoded). The pg driver returns jsonb as a parsed JS object, so parse
    // it back to match the route's original response shape byte-for-byte.
    case "json":      return typeof value === "string" ? JSON.parse(value) : value;
    default:          return value; // text / id / int / bool — pass through
  }
}

// Turn a camelCase GraphQL row into the snake_case, pg-shaped row. `spec` is an
// ordered list of [snake_column, kind] — the kind drives the representation
// coercion and the order reproduces the SQL SELECT column order. A column absent
// from the GraphQL row yields `undefined` (as a missing SELECT column would).
export function coerceRow(gqlRow, spec) {
  const out = {};
  for (const [col, kind] of spec) out[col] = coerce(gqlRow[camelKey(col)], kind);
  return out;
}

// Build the camelCase GraphQL selection-set body for a spec (the field list to
// request). Returns e.g. "id name url sortOrder". A `ref` field needs a
// sub-selection of the resolved object's id: "licenceId { id }".
export function selectionFor(spec) {
  return spec.map(([col, kind]) => (kind === "ref" ? `${camelKey(col)} { id }` : camelKey(col))).join(" ");
}
