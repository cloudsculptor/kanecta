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

import { randomUUID } from "crypto";

const BASE = process.env.KANECTA_API_URL || "http://127.0.0.1:3001";

// The domain items are parented under the datastore root, as the backfill placed
// them. Community-hub is single-tenant, so a flat root is fine.
export const ROOT_ID = "00000000-0000-0000-0000-000000000000";
// Owner stamped on items this app writes (mirrors the backfill's owner).
export const OWNER = "community-hub";

async function req(method, path, body) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: body ? { "content-type": "application/json" } : {},
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json;
  try { json = text ? JSON.parse(text) : {}; }
  catch { throw new Error(`kanecta-api ${path}: non-JSON response (${res.status}): ${text.slice(0, 200)}`); }
  if (!res.ok) throw new Error(`kanecta-api ${path} ${res.status}: ${JSON.stringify(json)}`);
  return json;
}
const post = (path, body) => req("POST", path, body);

// A fresh item id. Callers supply it so a transaction can reference an item it is
// about to create (e.g. a page_history row pointing at its page).
export function newId() { return randomUUID(); }

// Resolve a type name → its type-item UUID (cached). Typed items store `object`
// in `type` and the type UUID in `typeId`; writes must supply the UUID.
let _typesCache = null;
export async function resolveTypeId(name) {
  if (!_typesCache) {
    const defs = await req("GET", "/types");
    _typesCache = new Map(defs.map((d) => [d.value, d.id]));
  }
  const id = _typesCache.get(name);
  if (!id) throw new Error(`kanecta: no type named "${name}"`);
  return id;
}

// Run a GraphQL operation; returns the `data` object or throws on GraphQL errors.
export async function graphql(query, variables) {
  const json = await post("/graphql", { query, variables });
  if (json.errors) throw new Error(`kanecta graphql: ${JSON.stringify(json.errors)}`);
  return json.data;
}

// Create a single item (POST /items). `body` mirrors the endpoint: { type, value,
// parentId?, id?, objectData?, typeId?, ... }. Returns the created item.
export async function createItem(body) {
  return post("/items", body);
}

// Fetch an item by id (GET /items/:id), or null if absent.
export async function getItem(id) {
  try { return await req("GET", `/items/${id}`); }
  catch (e) { if (/ 404/.test(e.message)) return null; throw e; }
}

// Delete an item and its descendants (DELETE /items/:id). ?force skips the
// reference-conflict guard (used to clean up after write verification).
export async function deleteItem(id, { force = false } = {}) {
  return req("DELETE", `/items/${id}${force ? "?force=true" : ""}`);
}

// Execute an ordered list of generic item ops atomically (POST /transaction,
// PR #142). Each op is { op: 'create'|'update'|'delete'|'relate'|..., ... }.
// All commit together or all roll back. Returns the endpoint's result envelope.
export async function transaction(ops) {
  return post("/transaction", { ops });
}

// Update one item's projected object payload (a single atomic update op).
// `objectData` is the FULL camelCase column set — writeObjectJson validates it
// against the whole type schema, so callers resend unchanged required columns.
export async function updateObject(id, objectData) {
  return post("/transaction", { ops: [{ op: "update", id, changes: { objectData } }] });
}

export function apiBase() { return BASE; }
