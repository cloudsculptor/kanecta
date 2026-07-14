// Thin HTTP client for the Kanecta API — the transport the KanectaRepository
// speaks (community-hub → community-hub-api → **kanecta-api over HTTP** → Postgres
// in Kanecta four-table format). Owner decision #2: transport is HTTP; kanecta-api
// opens the datastore in-process. This module is the ONE place that knows the wire
// protocol; the per-domain kanecta repositories build queries/ops and map results.
//
// Reads go through POST /graphql (the uniform GraphQL-over-items surface: filtered,
// sorted, aggregated reads over the projected obj_<type> tables). Writes go through
// POST /items (single create) and POST /transaction (atomic ordered generic ops —
// PR #142), used by Phase C.

const BASE = process.env.KANECTA_API_URL || "http://127.0.0.1:3001";

async function post(path, body) {
  const res = await fetch(`${BASE}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  let json;
  try { json = text ? JSON.parse(text) : {}; }
  catch { throw new Error(`kanecta-api ${path}: non-JSON response (${res.status}): ${text.slice(0, 200)}`); }
  if (!res.ok) throw new Error(`kanecta-api ${path} ${res.status}: ${JSON.stringify(json)}`);
  return json;
}

// Run a GraphQL operation; returns the `data` object or throws on GraphQL errors.
export async function graphql(query, variables) {
  const json = await post("/graphql", { query, variables });
  if (json.errors) throw new Error(`kanecta graphql: ${JSON.stringify(json.errors)}`);
  return json.data;
}

// Create a single item (POST /items). `body` mirrors the endpoint: { type, value,
// parentId?, id?, object?, ... }. Returns the created item.
export async function createItem(body) {
  return post("/items", body);
}

// Execute an ordered list of generic item ops atomically (POST /transaction,
// PR #142). Each op is { op: 'create'|'update'|'delete'|'relate'|..., ... }.
// All commit together or all roll back. Returns the endpoint's result envelope.
export async function transaction(ops) {
  return post("/transaction", { ops });
}

export function apiBase() { return BASE; }
