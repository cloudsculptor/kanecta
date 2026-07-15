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
import { deleteItem, graphql } from "../lib/kanectaClient.js";

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

console.log(`\n${pass}/${pass + fail} write checks passed.`);
process.exit(fail ? 1 : 0);
