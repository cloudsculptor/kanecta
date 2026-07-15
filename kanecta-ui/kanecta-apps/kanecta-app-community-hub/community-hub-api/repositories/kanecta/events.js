// KanectaRepository — events over kanecta-api (GraphQL). The pg repo threads a `db`
// handle (pool or tx client) through every method for the S3-interleaved image
// transaction; the Kanecta path speaks HTTP, so the `db` arg is accepted and
// ignored. File-BYTES event methods (hero/gallery image up/down) live in the
// native-file section; here it's event records + event_file record reads.
import { graphql, createItem, updateObject, getItem, deleteItem, resolveTypeId, ROOT_ID, OWNER } from "../../lib/kanectaClient.js";
import { coerceRow, selectionFor } from "../../lib/kanectaMap.js";

const UPCOMING = [
  ["id", "id"], ["title", "text"], ["description", "text"], ["start_date", "date"], ["start_time", "text"],
  ["end_date", "date"], ["end_time", "text"], ["address", "text"], ["lat", "float"], ["lng", "float"],
  ["website", "text"], ["phone", "text"], ["email", "text"], ["area", "text"], ["submitted_at", "timestamp"],
];
const MINE = [
  ["id", "id"], ["title", "text"], ["start_date", "date"], ["start_time", "text"], ["end_date", "date"],
  ["status", "text"], ["decline_reason", "text"], ["submitted_at", "timestamp"],
];
const PENDING = [
  ["id", "id"], ["title", "text"], ["description", "text"], ["start_date", "date"], ["start_time", "text"],
  ["end_date", "date"], ["end_time", "text"], ["address", "text"], ["lat", "float"], ["lng", "float"],
  ["website", "text"], ["phone", "text"], ["email", "text"], ["area", "text"],
  ["organiser_name", "text"], ["organiser_email", "text"], ["organiser_phone", "text"],
  ["submitted_by_name", "text"], ["submitted_at", "timestamp"],
];
const DETAIL = [
  ["id", "id"], ["title", "text"], ["description", "text"], ["start_date", "date"], ["start_time", "text"],
  ["end_date", "date"], ["end_time", "text"], ["address", "text"], ["lat", "float"], ["lng", "float"],
  ["website", "text"], ["phone", "text"], ["email", "text"], ["area", "text"], ["status", "text"],
  ["organiser_name", "text"], ["organiser_email", "text"], ["organiser_phone", "text"],
  ["submitted_by_id", "text"], ["submitted_at", "timestamp"],
];

// pg: WHERE status='approved' AND deleted_at IS NULL AND COALESCE(end_date,start_date)
//     >= CURRENT_DATE ORDER BY start_date ASC. GraphQL can't do the COALESCE date
//     comparison, so filter it in JS. "today" = the dev pg's tz (UTC) current date;
//     the app's server should share the DB tz in prod.
export async function listUpcomingApprovedEvents(_db) {
  const today = new Date().toISOString().slice(0, 10);
  const data = await graphql(
    `{ eventses(where:{status:{eq:"approved"}, deletedAt:{isNull:true}},
        sort:[{field:startDate,direction:ASC}], limit:500){ ${selectionFor(UPCOMING)} } }`,
  );
  return data.eventses
    .map((r) => coerceRow(r, UPCOMING))
    .filter((e) => (e.end_date || e.start_date) >= today);
}

// pg: WHERE submitted_by_id=$1 AND deleted_at IS NULL ORDER BY submitted_at DESC
export async function listMyEvents(_db, userId) {
  const data = await graphql(
    `query($u:String){ eventses(where:{submittedById:{eq:$u}, deletedAt:{isNull:true}},
        sort:[{field:submittedAt,direction:DESC}], limit:500){ ${selectionFor(MINE)} } }`,
    { u: userId },
  );
  return data.eventses.map((r) => coerceRow(r, MINE));
}

// pg: WHERE status='pending' AND deleted_at IS NULL ORDER BY submitted_at ASC
export async function listPendingEvents(_db) {
  const data = await graphql(
    `{ eventses(where:{status:{eq:"pending"}, deletedAt:{isNull:true}},
        sort:[{field:submittedAt,direction:ASC}], limit:500){ ${selectionFor(PENDING)} } }`,
  );
  return data.eventses.map((r) => coerceRow(r, PENDING));
}

// pg: full detail WHERE id=$1 AND deleted_at IS NULL → row or null
export async function getEventDetail(_db, id) {
  const data = await graphql(
    `query($id:ID){ eventses(where:{id:{eq:$id}, deletedAt:{isNull:true}}, limit:1){ ${selectionFor(DETAIL)} } }`,
    { id },
  );
  return data.eventses[0] ? coerceRow(data.eventses[0], DETAIL) : null;
}

// pg: SELECT submitted_by_id, deleted_at WHERE id=$1 (no deleted filter) → row or null
export async function getEventForDelete(_db, id) {
  const data = await graphql(
    `query($id:ID){ eventses(where:{id:{eq:$id}}, limit:1){ submittedById deletedAt } }`, { id },
  );
  const e = data.eventses[0];
  return e ? { submitted_by_id: e.submittedById, deleted_at: e.deletedAt == null ? null : new Date(e.deletedAt).toISOString() } : null;
}

// pg: SELECT submitted_by_id, status WHERE id=$1 → row or null
export async function getEventOwnerStatus(_db, id) {
  const data = await graphql(
    `query($id:ID){ eventses(where:{id:{eq:$id}}, limit:1){ submittedById status } }`, { id },
  );
  const e = data.eventses[0];
  return e ? { submitted_by_id: e.submittedById, status: e.status } : null;
}

// pg: UPDATE events SET deleted_at=NOW() WHERE id=$1
export async function softDeleteEvent(_db, id) {
  const item = await getItem(id);
  if (!item?.payload) return;
  await updateObject(id, { ...item.payload, deletedAt: new Date().toISOString() });
}

// pg: INSERT INTO events (...) RETURNING id. status defaults 'pending', submitted_at
//     NOW(); reviewed_* / decline_reason / deleted_at are null.
export async function createEvent(_db, {
  title, description, startDate, startTime, endDate, endTime,
  address, lat, lng, website, phone, email,
  organiserName, organiserEmail, organiserPhone, area, submittedById, submittedByName,
}) {
  const typeId = await resolveTypeId("events");
  const item = await createItem({
    type: "object", typeId, parentId: ROOT_ID, owner: OWNER,
    objectData: {
      title, description: description ?? null, startDate, startTime: startTime ?? null,
      endDate: endDate ?? null, endTime: endTime ?? null, address: address ?? null,
      lat: lat ?? null, lng: lng ?? null, website: website ?? null, phone: phone ?? null, email: email ?? null,
      organiserName: organiserName ?? null, organiserEmail: organiserEmail ?? null, organiserPhone: organiserPhone ?? null,
      area: area ?? "Featherston", status: "pending",
      submittedById, submittedByName, submittedAt: new Date().toISOString(),
      declineReason: null, reviewedById: null, reviewedByName: null, reviewedAt: null, deletedAt: null,
    },
  });
  return { id: item.id };
}

// pg: event_files ef JOIN files f WHERE ef.event_id=ANY AND f.deleted_at IS NULL
//     ORDER BY ef.event_id, ef.role DESC, ef.position (record read; the route
//     attaches image URLs). Joined in JS.
export async function getEventFiles(_db, ids) {
  if (!ids?.length) return [];
  const data = await graphql(
    `{ eventFileses(limit:2000){ eventId{id} fileId{id} role position } fileses(limit:2000){ id storageKey deletedAt } }`,
  );
  const idset = new Set(ids);
  const fileById = new Map(data.fileses.map((f) => [f.id, f]));
  const rows = data.eventFileses
    .filter((ef) => idset.has(ef.eventId?.id))
    .map((ef) => ({ ef, f: fileById.get(ef.fileId?.id) }))
    .filter((x) => x.f && x.f.deletedAt == null)
    .map(({ ef, f }) => ({ event_id: ef.eventId.id, role: ef.role, position: ef.position, file_id: f.id, storage_key: f.storageKey }));
  rows.sort((a, b) =>
    a.event_id < b.event_id ? -1 : a.event_id > b.event_id ? 1
      : a.role < b.role ? 1 : a.role > b.role ? -1 // role DESC
        : a.position - b.position);
  return rows;
}

// pg: event_files ef JOIN files f WHERE ef.event_id=$1 AND ef.role='hero'
//     -> { file_id, storage_key } or undefined
export async function getHeroImage(_db, eventId) {
  const data = await graphql(
    `query($e:ID){ eventFileses(where:{eventId:{eq:$e}, role:{eq:"hero"}}, limit:1){ fileId{id} } }`, { e: eventId },
  );
  const ef = data.eventFileses[0];
  if (!ef) return undefined;
  const fid = ef.fileId?.id;
  const file = await graphql(`query($id:ID){ fileses(where:{id:{eq:$id}}, limit:1){ storageKey } }`, { id: fid });
  return { file_id: fid, storage_key: file.fileses[0]?.storageKey ?? null };
}

// pg: DELETE FROM event_files WHERE event_id=$1 AND role='hero'
export async function deleteHeroEventFile(_db, eventId) {
  const data = await graphql(
    `query($e:ID){ eventFileses(where:{eventId:{eq:$e}, role:{eq:"hero"}}, limit:500){ id } }`, { e: eventId },
  );
  for (const ef of data.eventFileses) await deleteItem(ef.id, { force: true });
}

// pg: INSERT INTO event_files (event_id, file_id, role, position) VALUES (...)
export async function insertEventFile(_db, { eventId, fileId, role, position }) {
  const typeId = await resolveTypeId("event-files");
  await createItem({
    type: "object", typeId, parentId: ROOT_ID, owner: OWNER,
    objectData: { eventId, fileId, role, position, createdAt: new Date().toISOString() },
  });
}

// pg: DELETE FROM event_files WHERE event_id=$1 AND file_id=$2
export async function deleteEventFile(_db, eventId, fileId) {
  const data = await graphql(
    `query($e:ID,$f:ID){ eventFileses(where:{eventId:{eq:$e}, fileId:{eq:$f}}, limit:500){ id } }`, { e: eventId, f: fileId },
  );
  for (const ef of data.eventFileses) await deleteItem(ef.id, { force: true });
}

// pg: SELECT COUNT(*) FROM event_files WHERE event_id=$1 AND role='gallery'
export async function countGalleryImages(_db, eventId) {
  const data = await graphql(
    `query($e:ID){ eventFileses(where:{eventId:{eq:$e}, role:{eq:"gallery"}}, limit:500){ id } }`, { e: eventId },
  );
  return data.eventFileses.length;
}

// pg: UPDATE events SET status='pending' WHERE id=$1 (unconditional)
export async function setEventPendingIfApproved(_db, eventId) {
  const item = await getItem(eventId);
  if (!item?.payload) return;
  await updateObject(eventId, { ...item.payload, status: "pending" });
}

// pg: SELECT ef.file_id, f.storage_key FROM event_files ef JOIN files f
//     WHERE ef.event_id=$1 AND ef.file_id=$2 → row or undefined
export async function getEventFile(_db, eventId, fileId) {
  const data = await graphql(
    `query($e:ID,$f:ID){ eventFileses(where:{eventId:{eq:$e}, fileId:{eq:$f}}, limit:1){ fileId{id} } }`,
    { e: eventId, f: fileId },
  );
  const ef = data.eventFileses[0];
  if (!ef) return undefined;
  const fid = ef.fileId?.id;
  const file = await graphql(`query($id:ID){ fileses(where:{id:{eq:$id}}, limit:1){ storageKey } }`, { id: fid });
  return { file_id: fid, storage_key: file.fileses[0]?.storageKey ?? null };
}

// pg: UPDATE events SET (many fields), status=$17 WHERE id=$18 RETURNING id, status
export async function updateEvent(_db, {
  id, title, description, startDate, startTime, endDate, endTime,
  address, lat, lng, website, phone, email,
  organiserName, organiserEmail, organiserPhone, area, status,
}) {
  const item = await getItem(id);
  const p = item?.payload;
  if (!p) return undefined;
  await updateObject(id, {
    ...p,
    title, description: description ?? null, startDate, startTime: startTime ?? null,
    endDate: endDate ?? null, endTime: endTime ?? null, address: address ?? null,
    lat: lat ?? null, lng: lng ?? null, website: website ?? null, phone: phone ?? null, email: email ?? null,
    organiserName: organiserName ?? null, organiserEmail: organiserEmail ?? null, organiserPhone: organiserPhone ?? null,
    area: area ?? null, status,
  });
  return { id, status };
}

// pg: UPDATE ... SET status='approved', reviewed_* WHERE id AND status='pending'
//     AND deleted_at IS NULL RETURNING id → { id } or undefined
export async function approveEvent(_db, { id, reviewedById, reviewedByName }) {
  const item = await getItem(id);
  const p = item?.payload;
  if (!p || p.status !== "pending" || p.deletedAt != null) return undefined;
  await updateObject(id, { ...p, status: "approved", reviewedById, reviewedByName, reviewedAt: new Date().toISOString() });
  return { id };
}

// pg: UPDATE ... SET status='declined', decline_reason, reviewed_* WHERE id AND
//     status='pending' AND deleted_at IS NULL RETURNING id → { id } or undefined
export async function declineEvent(_db, { id, declineReason, reviewedById, reviewedByName }) {
  const item = await getItem(id);
  const p = item?.payload;
  if (!p || p.status !== "pending" || p.deletedAt != null) return undefined;
  await updateObject(id, {
    ...p, status: "declined", declineReason, reviewedById, reviewedByName, reviewedAt: new Date().toISOString(),
  });
  return { id };
}
