// Phase C write verification over HTTP: exercise the KanectaRepository write path
// (POST /items + POST /transaction against kanecta-api) and assert each write
// round-trips through the read path. Every case cleans up after itself so the
// backfilled read fixture stays intact and the script is idempotent.
//
// Run (kanecta-api up on :3001 over communityhub_backfill):
//   KANECTA_API_URL=http://127.0.0.1:3001 node scripts/verify-kanecta-writes.js
import * as suggestions from "../repositories/kanecta/suggestions.js";
import * as finances from "../repositories/kanecta/finances.js";
import * as pages from "../repositories/kanecta/pages.js";
import * as trust from "../repositories/kanecta/trust.js";
import * as push from "../repositories/kanecta/push.js";
import * as notices from "../repositories/kanecta/notices.js";
import * as disc from "../repositories/kanecta/discussions.js";
import * as events from "../repositories/kanecta/events.js";
import * as download from "../repositories/kanecta/download.js";
import { deleteItem, graphql, createItem, resolveTypeId, ROOT_ID, OWNER } from "../lib/kanectaClient.js";

// Delete every item matching a single-field GraphQL filter (test cleanup).
async function purge(field, plural, whereField, value) {
  const data = await graphql(
    `query($v:String){ ${plural}(where:{${whereField}:{eq:$v}}, limit:500){ id } }`, { v: value },
  ).catch(() => ({ [plural]: [] }));
  for (const r of data[plural] || []) await deleteItem(r.id, { force: true });
}

let pass = 0, fail = 0;
const ok = (name, cond, detail) => {
  if (cond) { console.log(`  ✓ ${name}`); pass++; }
  else { console.log(`  ✗ ${name}${detail ? "  " + detail : ""}`); fail++; }
};

// ── create (single item): suggestions.createSuggestion ───────────────────────
{
  const before = (await suggestions.listActiveSuggestions()).length;
  const { id } = await suggestions.createSuggestion({
    content: "PHASE-C probe suggestion", submittedById: "u-test", submittedByName: "Test User",
  });
  const active = await suggestions.listActiveSuggestions();
  const found = active.find((s) => s.id === id);
  ok("createSuggestion → appears in listActiveSuggestions",
    active.length === before + 1 && found && found.content === "PHASE-C probe suggestion",
    JSON.stringify(found));
  await deleteItem(id, { force: true });
  ok("createSuggestion cleanup", (await suggestions.listActiveSuggestions()).length === before);
}

// ── create + update + delete: finances transactions ──────────────────────────
{
  const created = await finances.createTransaction({
    date: "2026-07-01", description: "PHASE-C probe txn", amount: "12.34", type: "expense",
    category: "testing", reference: "REF1", sortOrder: 99, createdById: "u-test", createdByName: "Test User",
  });
  ok("createTransaction → returns pg-shaped row",
    created && created.description === "PHASE-C probe txn" && created.amount === "12.34"
      && created.type === "expense" && created.sort_order === 99, JSON.stringify(created));
  const id = created.id;

  const updated = await finances.updateTransaction({
    id, date: "2026-07-02", description: "PHASE-C probe txn EDITED", amount: "56.78",
    type: "income", category: "testing", reference: "REF2", sortOrder: 1,
  });
  ok("updateTransaction → merged new values",
    updated && updated.description === "PHASE-C probe txn EDITED" && updated.amount === "56.78"
      && updated.type === "income" && updated.date === "2026-07-02", JSON.stringify(updated));

  const delId = await finances.deleteTransaction(id);
  const gone = await graphql(`query($id:ID){ financesTransactionses(where:{id:{eq:$id}}, limit:1){ id } }`, { id });
  ok("deleteTransaction → row removed", delId === id && gone.financesTransactionses.length === 0);
}

// ── atomic multi-item: pages.createPageWithHistory (page + history in one tx) ──
{
  const slug = "phase-c-probe-page";
  const page = await pages.createPageWithHistory({
    slug, title: "Phase C Probe", contentJson: { root: { children: [] } },
    createdById: "u-test", createdByName: "Test User", licenceId: null, ownerType: "group", ownerId: null,
  });
  ok("createPageWithHistory → page row",
    page && page.slug === slug && page.version === 1 && page.public === false, JSON.stringify(page));

  // The initial history row committed in the SAME transaction.
  const hist = await graphql(
    `query($p:ID){ pageHistories(where:{pageId:{eq:$p}}, limit:10){ action version } }`,
    { p: page?.id },
  ).catch((e) => ({ error: e.message }));
  const rows = hist.pageHistories;
  ok("createPageWithHistory → initial 'Created' history row committed atomically",
    Array.isArray(rows) && rows.length === 1 && rows[0].action === "Created" && rows[0].version === 1,
    JSON.stringify(hist));

  // Cleanup: delete the history row(s) FIRST (they FK-reference the page), then
  // the page itself.
  if (page?.id) {
    const ids = await graphql(`query($p:ID){ pageHistories(where:{pageId:{eq:$p}}, limit:10){ id } }`, { p: page.id });
    for (const h of ids.pageHistories) await deleteItem(h.id, { force: true });
    await deleteItem(page.id, { force: true });
  }
  const check = await graphql(`query($s:String){ pageses(where:{slug:{eq:$s}}, limit:1){ id } }`, { s: slug });
  ok("createPageWithHistory cleanup", check.pageses.length === 0);
}

// ── trust.createEndorsement → getEndorsementFor + isEndorsed reflect it ───────
{
  const u = "phase4-trust-user";
  await purge("trusts", "trusts", "userId", u); // idempotent start
  await trust.createEndorsement({
    userId: u, endorsedById: "endorser-1", knowPersonally: true, trustedBySomeone: false,
    resilienceHui: true, otherReason: "probe", locality: "Featherston",
  });
  const e = await trust.getEndorsementFor(u);
  ok("createEndorsement → getEndorsementFor returns the record",
    e && e.endorsed_by_id === "endorser-1" && e.know_personally === true
      && e.resilience_hui === true && e.other_reason === "probe", JSON.stringify(e));
  ok("createEndorsement → isEndorsed(user) true", (await trust.isEndorsed(u)) === true);
  await purge("trusts", "trusts", "userId", u);
  ok("createEndorsement cleanup", (await trust.isEndorsed(u)) === false);
}

// ── push: upsert subscription (insert → update same endpoint) + delete ────────
{
  const u = "phase4-push-user";
  await purge(null, "pushSubscriptionses", "userId", u);
  const endpoint = "https://push.example/endpoint-A";
  await push.upsertPushSubscription(u, { endpoint, keys: { auth: "a1", p256dh: "p1" } });
  let subs = await push.getUserSubscriptions(u);
  ok("upsertPushSubscription insert → 1 subscription",
    subs.length === 1 && subs[0].subscription.keys.auth === "a1", JSON.stringify(subs));
  // Same endpoint again → upsert updates in place (still 1 row, new keys).
  await push.upsertPushSubscription(u, { endpoint, keys: { auth: "a2", p256dh: "p2" } });
  subs = await push.getUserSubscriptions(u);
  ok("upsertPushSubscription same endpoint → updated in place (still 1)",
    subs.length === 1 && subs[0].subscription.keys.auth === "a2", JSON.stringify(subs));
  await push.deletePushSubscription(u, endpoint);
  ok("deletePushSubscription → 0", (await push.getUserSubscriptions(u)).length === 0);
}

// ── push: upsert FCM token (insert → idempotent no-op) + delete ───────────────
{
  const u = "phase4-fcm-user";
  await purge(null, "fcmTokenses", "userId", u);
  await push.upsertFcmToken(u, "TOKEN-1");
  await push.upsertFcmToken(u, "TOKEN-1"); // ON CONFLICT DO NOTHING → still 1
  const t1 = await graphql(`query($u:String){ fcmTokenses(where:{userId:{eq:$u}}, limit:10){ id token } }`, { u });
  ok("upsertFcmToken insert + idempotent → exactly 1 token",
    t1.fcmTokenses.length === 1 && t1.fcmTokenses[0].token === "TOKEN-1", JSON.stringify(t1.fcmTokenses));
  await push.deleteFcmToken(u, "TOKEN-1");
  const t2 = await graphql(`query($u:String){ fcmTokenses(where:{userId:{eq:$u}}, limit:10){ id } }`, { u });
  ok("deleteFcmToken → 0", t2.fcmTokenses.length === 0);
}

// ── push: upsert preference (insert → update enabled) ─────────────────────────
{
  const u = "phase4-pref-user";
  await purge(null, "notificationPreferenceses", "userId", u);
  await push.upsertPreference(u, "notices", true);
  let prefs = await push.getPreferences(u);
  ok("upsertPreference insert → enabled true",
    prefs.length === 1 && prefs[0].category === "notices" && prefs[0].enabled === true, JSON.stringify(prefs));
  await push.upsertPreference(u, "notices", false);
  prefs = await push.getPreferences(u);
  ok("upsertPreference same category → updated in place (still 1, enabled false)",
    prefs.length === 1 && prefs[0].enabled === false, JSON.stringify(prefs));
  await purge(null, "notificationPreferenceses", "userId", u);
  ok("upsertPreference cleanup", (await push.getPreferences(u)).length === 0);
}

// ── notices: create → approve (pending→approved) ─────────────────────────────
{
  const { id } = await notices.createNotice({
    heading: "PHASE4 probe notice", body: "body text", noticeDate: "2026-07-10",
    submittedById: "u-test", submittedByName: "Test User",
  });
  ok("createNotice → owner readable + pending", (await notices.getNoticeOwner(id)) === "u-test");
  const pending = await notices.listPendingNotices();
  ok("createNotice → appears in pending", pending.some((n) => n.id === id));
  const app = await notices.approveNotice({ id, reviewedById: "mod-1", reviewedByName: "Mod One" });
  ok("approveNotice → returns { id }", app && app.id === id);
  const approved = await notices.listApprovedNotices();
  ok("approveNotice → now in approved list", approved.some((n) => n.id === id));
  // Re-approving is a no-op (no longer pending) → undefined.
  ok("approveNotice again → undefined (not pending)",
    (await notices.approveNotice({ id, reviewedById: "mod-1", reviewedByName: "Mod One" })) === undefined);
  await deleteItem(id, { force: true });
}

// ── notices: create → decline, then softDelete ───────────────────────────────
{
  const { id } = await notices.createNotice({
    heading: "PHASE4 decline notice", body: "b", noticeDate: "2026-07-10",
    submittedById: "u-test", submittedByName: "Test User",
  });
  const dec = await notices.declineNotice({ id, declineReason: "spam", reviewedById: "mod-1", reviewedByName: "Mod One" });
  ok("declineNotice → returns { id }", dec && dec.id === id);
  await notices.softDeleteNotice(id);
  ok("softDeleteNotice → getNoticeOwner null (filtered by deleted_at)",
    (await notices.getNoticeOwner(id)) === null);
  await deleteItem(id, { force: true });
}

// ── suggestions.archiveSuggestion (active → archived) ────────────────────────
{
  const { id } = await suggestions.createSuggestion({
    content: "PHASE4 archive probe", submittedById: "u-test", submittedByName: "Test User",
  });
  ok("createSuggestion (for archive) → active", (await suggestions.listActiveSuggestions()).some((s) => s.id === id));
  const n1 = await suggestions.archiveSuggestion({ id, archivedById: "mod-1" });
  ok("archiveSuggestion → rowCount 1", n1 === 1);
  ok("archiveSuggestion → now archived", (await suggestions.listArchivedSuggestions()).some((s) => s.id === id));
  const n2 = await suggestions.archiveSuggestion({ id, archivedById: "mod-1" });
  ok("archiveSuggestion again → rowCount 0 (already archived)", n2 === 0);
  await deleteItem(id, { force: true });
}

// ── discussions: thread + message + reply + reactions + read-state lifecycle ──
{
  const U = "phase4-disc-user";
  const OTHER = "phase4-disc-other";
  // createThread
  const thread = await disc.createThread({ name: "PHASE4 probe thread", description: "d", createdByUserId: U, createdByName: "Disc User" });
  ok("createThread → returns row with name + null sort_order",
    thread && thread.name === "PHASE4 probe thread" && thread.sort_order === null, JSON.stringify(thread));
  const tid = thread.id;
  ok("getThreadName → name", (await disc.getThreadName(tid))?.name === "PHASE4 probe thread");
  ok("getThreadForArchive → creator", (await disc.getThreadForArchive(tid))?.created_by_user_id === U);
  ok("findDuplicateThreads matches normalized name", (await disc.findDuplicateThreads("phase4probethread")).some((t) => t.id === tid));

  // touchThreadLatestMessage
  const at = "2026-07-16T00:00:00.000Z";
  await disc.touchThreadLatestMessage(tid, at);
  const tcheck = await graphql(`query($id:ID){ discussionsThreadses(where:{id:{eq:$id}},limit:1){ latestMessageAt } }`, { id: tid });
  ok("touchThreadLatestMessage → latest_message_at set", Date.parse(tcheck.discussionsThreadses[0].latestMessageAt) === Date.parse(at));

  // createMessage
  const msg = await disc.createMessage({ threadId: tid, userId: U, userName: "Disc User", content: "hello" });
  ok("createMessage → row with reply_count 0", msg && msg.content === "hello" && msg.reply_count === 0 && msg.thread_id === tid, JSON.stringify(msg));
  ok("createMessage → in listThreadMessages", (await disc.listThreadMessages(tid, 50)).some((m) => m.id === msg.id));

  // updateMessage (author ok; other denied)
  const upd = await disc.updateMessage(msg.id, "hello edited", U);
  ok("updateMessage (author) → content changed + edited_at", upd && upd.content === "hello edited" && upd.edited_at != null);
  ok("updateMessage (non-author) → undefined", (await disc.updateMessage(msg.id, "hax", OTHER)) === undefined);

  // createReply → parent reply_count becomes 1
  const reply = await disc.createReply({ threadId: tid, parentMessageId: msg.id, userId: OTHER, userName: "Other", content: "a reply" });
  ok("createReply → row under parent", reply && reply.parent_message_id === msg.id && reply.content === "a reply", JSON.stringify(reply));
  ok("listReplies → shows the reply", (await disc.listReplies(msg.id)).some((r) => r.id === reply.id));
  ok("parent reply_count now 1", (await disc.listThreadMessages(tid, 50)).find((m) => m.id === msg.id)?.reply_count === 1);
  ok("getParentMessage → { id, thread_id }", (await disc.getParentMessage(msg.id))?.thread_id === tid);
  ok("getMessageThreadId(reply) → thread", (await disc.getMessageThreadId(reply.id))?.thread_id === tid);

  // reactions
  await disc.addReaction(msg.id, U, "Disc User", "👍");
  await disc.addReaction(msg.id, U, "Disc User", "👍"); // idempotent
  let rx = await disc.getMessageReactions(msg.id);
  ok("addReaction → 1 group count 1 (idempotent)", rx.length === 1 && rx[0].emoji === "👍" && rx[0].count === "1", JSON.stringify(rx));
  await disc.addReaction(msg.id, OTHER, "Other", "👍");
  rx = await disc.getMessageReactions(msg.id);
  ok("addReaction (2nd user) → count 2", rx[0].count === "2" && rx[0].user_ids.length === 2);
  ok("getThreadReactions → includes the message group", (await disc.getThreadReactions(tid)).some((g) => g.message_id === msg.id && g.emoji === "👍"));
  await disc.removeReaction(msg.id, U, "👍");
  await disc.removeReaction(msg.id, OTHER, "👍");
  ok("removeReaction → gone", (await disc.getMessageReactions(msg.id)).length === 0);

  // notification subscriptions
  await disc.subscribeThreadNotifications(U, tid);
  await disc.subscribeThreadNotifications(U, tid); // idempotent
  const subs = await graphql(`query($u:String,$t:ID){ threadNotificationSubscriptionses(where:{userId:{eq:$u},threadId:{eq:$t}},limit:10){ id } }`, { u: U, t: tid });
  ok("subscribeThreadNotifications → exactly 1 (idempotent)", subs.threadNotificationSubscriptionses.length === 1);
  await disc.unsubscribeThreadNotifications(U, tid);
  const subs2 = await graphql(`query($u:String,$t:ID){ threadNotificationSubscriptionses(where:{userId:{eq:$u},threadId:{eq:$t}},limit:10){ id } }`, { u: U, t: tid });
  ok("unsubscribeThreadNotifications → 0", subs2.threadNotificationSubscriptionses.length === 0);

  // upsertThreadRead never moves backwards; markThreadRead sets to max message time
  await disc.upsertThreadRead(U, tid, "2026-07-10T00:00:00.000Z");
  await disc.upsertThreadRead(U, tid, "2026-07-05T00:00:00.000Z"); // older → ignored
  let tr = await graphql(`query($u:String,$t:ID){ discussionsThreadReadses(where:{userId:{eq:$u},threadId:{eq:$t}},limit:1){ lastReadAt } }`, { u: U, t: tid });
  ok("upsertThreadRead → does not move backwards", Date.parse(tr.discussionsThreadReadses[0].lastReadAt) === Date.parse("2026-07-10T00:00:00.000Z"));
  await disc.upsertThreadRead(U, tid, "2026-07-12T00:00:00.000Z"); // newer → moves
  tr = await graphql(`query($u:String,$t:ID){ discussionsThreadReadses(where:{userId:{eq:$u},threadId:{eq:$t}},limit:1){ lastReadAt } }`, { u: U, t: tid });
  ok("upsertThreadRead → moves forward", Date.parse(tr.discussionsThreadReadses[0].lastReadAt) === Date.parse("2026-07-12T00:00:00.000Z"));

  // deleteMessage (author) → soft-deleted, blanked
  const del = await disc.deleteMessage(reply.id, OTHER, false);
  ok("deleteMessage (author) → soft-deleted + blanked", del && del.deleted_at != null && del.content === "");
  ok("deleteMessage (already deleted) → undefined", (await disc.deleteMessage(reply.id, OTHER, false)) === undefined);

  // archiveThread → getThreadForArchive undefined
  await disc.archiveThread(tid);
  ok("archiveThread → getThreadForArchive undefined (archived)", (await disc.getThreadForArchive(tid)) === undefined);

  // cleanup: messages, reads, thread
  // obj_<message> has physical FK constraints (parent_message_id, thread_id) that
  // ?force doesn't bypass, so hard-delete in dependency order: reply → message → thread.
  for (const mid of [reply.id, msg.id]) await deleteItem(mid, { force: true });
  await purge(null, "discussionsThreadReadses", "userId", U);
  await deleteItem(tid, { force: true });
  ok("discussions cleanup", (await disc.getThreadName(tid)) === undefined);
}

// ── events: create → detail → update → approve → pending → decline → delete ──
{
  const { id } = await events.createEvent(null, {
    title: "PHASE4 event", description: "desc", startDate: "2026-08-01", startTime: "18:00:00",
    endDate: "2026-08-01", endTime: "20:00:00", address: "1 Main St", lat: -41.12, lng: 175.32,
    website: "https://x", phone: "123", email: "e@x", organiserName: "Org", organiserEmail: "o@x",
    organiserPhone: "999", area: "Featherston", submittedById: "u-test", submittedByName: "Test User",
  });
  ok("createEvent → returns { id }", !!id);
  const detail = await events.getEventDetail(null, id);
  ok("createEvent → getEventDetail reflects it (pending, lat/lng)",
    detail && detail.title === "PHASE4 event" && detail.status === "pending" && detail.lat === -41.12, JSON.stringify(detail));
  ok("createEvent → getEventOwnerStatus", (await events.getEventOwnerStatus(null, id))?.submitted_by_id === "u-test");

  const upd = await events.updateEvent(null, {
    id, title: "PHASE4 event EDITED", description: "d2", startDate: "2026-08-02", startTime: "19:00:00",
    endDate: null, endTime: null, address: "2 Main", lat: -41.2, lng: 175.4, website: null, phone: null,
    email: null, organiserName: "Org2", organiserEmail: null, organiserPhone: null, area: "Greytown", status: "pending",
  });
  ok("updateEvent → returns { id, status }", upd && upd.id === id && upd.status === "pending");
  const d2 = await events.getEventDetail(null, id);
  ok("updateEvent → fields merged", d2.title === "PHASE4 event EDITED" && d2.area === "Greytown" && d2.lat === -41.2, JSON.stringify(d2));

  ok("approveEvent → { id }", (await events.approveEvent(null, { id, reviewedById: "mod", reviewedByName: "Mod" }))?.id === id);
  ok("approveEvent → status approved", (await events.getEventOwnerStatus(null, id))?.status === "approved");
  ok("approveEvent again → undefined (not pending)", (await events.approveEvent(null, { id, reviewedById: "mod", reviewedByName: "Mod" })) === undefined);

  await events.setEventPendingIfApproved(null, id);
  ok("setEventPendingIfApproved → back to pending", (await events.getEventOwnerStatus(null, id))?.status === "pending");
  ok("declineEvent → { id }", (await events.declineEvent(null, { id, declineReason: "no", reviewedById: "mod", reviewedByName: "Mod" }))?.id === id);
  ok("declineEvent → status declined", (await events.getEventOwnerStatus(null, id))?.status === "declined");

  await events.softDeleteEvent(null, id);
  ok("softDeleteEvent → getEventDetail null", (await events.getEventDetail(null, id)) === null);
  ok("softDeleteEvent → getEventForDelete has deleted_at", (await events.getEventForDelete(null, id))?.deleted_at != null);
  await deleteItem(id, { force: true });
  ok("events cleanup", (await events.getEventOwnerStatus(null, id)) === null);
}

// ── file join-row writes: attachFilesToMessage + event_files insert/delete ────
{
  const A_FILE = "41666c6d-32eb-46de-a9a0-bf8d3cdc9ffd";
  const HERO_FILE = "94d946da-b9b0-44fb-8983-50ba982c5b96"; // a distinct file (event_files has UNIQUE(event_id,file_id))
  const FILE_OWNER = "111f6452-1c13-4251-b937-4c7696906d50"; // A_FILE's uploader
  // attachFilesToMessage: only the uploader's files attach; dedups
  const thread = await disc.createThread({ name: "PHASE4 file thread", description: "d", createdByUserId: FILE_OWNER, createdByName: "Owner" });
  const msg = await disc.createMessage({ threadId: thread.id, userId: FILE_OWNER, userName: "Owner", content: "with file" });
  await disc.attachFilesToMessage(msg.id, [A_FILE], FILE_OWNER);
  await disc.attachFilesToMessage(msg.id, [A_FILE], FILE_OWNER); // dedup
  const mf = await disc.getMessageFiles(msg.id);
  ok("attachFilesToMessage → 1 file (dedup)", mf.length === 1 && mf[0].file_id === A_FILE, JSON.stringify(mf));
  await disc.attachFilesToMessage(msg.id, [A_FILE], "someone-else"); // not owner → no-op
  ok("attachFilesToMessage (non-owner) → still 1", (await disc.getMessageFiles(msg.id)).length === 1);
  // cleanup dmf + message + thread
  const dmfs = await graphql(`query($m:ID){ discussionsMessageFileses(where:{messageId:{eq:$m}},limit:10){ id } }`, { m: msg.id });
  for (const d of dmfs.discussionsMessageFileses) await deleteItem(d.id, { force: true });
  await deleteItem(msg.id, { force: true });
  await deleteItem(thread.id, { force: true });

  // event_files: insert hero + gallery, count, delete
  const ev = await events.createEvent(null, { title: "PHASE4 file event", startDate: "2026-08-01", submittedById: "u-test", submittedByName: "T" });
  await events.insertEventFile(null, { eventId: ev.id, fileId: A_FILE, role: "gallery", position: 0 });
  ok("insertEventFile (gallery) → countGalleryImages 1", (await events.countGalleryImages(null, ev.id)) === 1);
  await events.insertEventFile(null, { eventId: ev.id, fileId: HERO_FILE, role: "hero", position: 0 });
  ok("getHeroImage → the hero file", (await events.getHeroImage(null, ev.id))?.file_id === HERO_FILE);
  ok("getEventFiles → 2 rows (hero first, role DESC)", (await events.getEventFiles(null, [ev.id])).length === 2 && (await events.getEventFiles(null, [ev.id]))[0].role === "hero");
  await events.deleteHeroEventFile(null, ev.id);
  ok("deleteHeroEventFile → hero gone", (await events.getHeroImage(null, ev.id)) === undefined);
  await events.deleteEventFile(null, ev.id, A_FILE);
  ok("deleteEventFile → gallery gone", (await events.countGalleryImages(null, ev.id)) === 0);
  await deleteItem(ev.id, { force: true });
  ok("file-write cleanup", (await events.getEventOwnerStatus(null, ev.id)) === null);
}

// ── pages.updatePageWithHistory (page update + history + removed-file soft-delete)
{
  const PUBLIC_URL = process.env.SPACES_PUBLIC_URL; // set by the runner for this case
  const slug = "phase4-update-page";
  // A throwaway file item referenced by the initial content, then removed on update.
  const fileType = await resolveTypeId("files");
  const file = await createItem({
    type: "object", typeId: fileType, parentId: ROOT_ID, owner: OWNER,
    objectData: { name: "img.png", storageKey: "ph/4/img", mimeType: "image/png", sizeBytes: 10,
      description: null, uploadedById: "u-test", uploadedByName: "T", createdAt: new Date().toISOString(), deletedAt: null },
  });
  const imgSrc = PUBLIC_URL ? `${PUBLIC_URL}/ph/4/${file.id}` : `https://none/ph/4/${file.id}`;
  const withImage = { root: { children: [{ type: "image", src: imgSrc }] } };
  const withoutImage = { root: { children: [] } };

  const page = await pages.createPageWithHistory({
    slug, title: "Upd", contentJson: withImage, createdById: "u-test", createdByName: "T",
    licenceId: null, ownerType: "group", ownerId: null,
  });
  // Update: publish it (draft→public) and drop the image.
  const res = await pages.updatePageWithHistory({
    currentSlug: slug, targetSlug: slug, title: "Upd v2", contentJson: withoutImage,
    licenceId: null, isPublic: true, ownerType: null, ownerId: null, userId: "u-test", userName: "T",
  });
  ok("updatePageWithHistory → returns { row, action=Published }", res && res.action === "Published" && res.row.version === 2, JSON.stringify(res?.action));
  ok("updatePageWithHistory → page now public + v2", res.row.public === true && res.row.title === "Upd v2");
  const hist = await graphql(`query($p:ID){ pageHistories(where:{pageId:{eq:$p}}, sort:[{field:version,direction:ASC}], limit:10){ action version } }`, { p: page.id });
  ok("updatePageWithHistory → 2 history rows (Created, Published)",
    hist.pageHistories.length === 2 && hist.pageHistories[1].action === "Published", JSON.stringify(hist.pageHistories));
  const f = await graphql(`query($id:ID){ fileses(where:{id:{eq:$id}}, limit:1){ deletedAt } }`, { id: file.id });
  if (PUBLIC_URL) ok("updatePageWithHistory → removed image file soft-deleted", f.fileses[0]?.deletedAt != null, JSON.stringify(f.fileses[0]));
  else ok("updatePageWithHistory → (file soft-delete skipped: no SPACES_PUBLIC_URL)", true);

  // cleanup
  const hids = await graphql(`query($p:ID){ pageHistories(where:{pageId:{eq:$p}}, limit:10){ id } }`, { p: page.id });
  for (const h of hids.pageHistories) await deleteItem(h.id, { force: true });
  await deleteItem(page.id, { force: true });
  await deleteItem(file.id, { force: true });
  ok("updatePageWithHistory cleanup", (await graphql(`query($s:String){ pageses(where:{slug:{eq:$s}}, limit:1){ id } }`, { s: slug })).pageses.length === 0);
}

console.log(`\n${pass}/${pass + fail} write checks passed.`);
process.exit(fail ? 1 : 0);
