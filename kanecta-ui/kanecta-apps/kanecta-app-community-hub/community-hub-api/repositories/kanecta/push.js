// KanectaRepository — push/FCM subscriptions and notification preferences over
// kanecta-api. The pg upserts (ON CONFLICT) become read-by-idempotency-key →
// create-or-update, mirroring the seedThreadReads shape. The DELETE-by-predicate
// paths resolve the matching item ids first, then delete them. `subscription` is a
// jsonb column projected to a string property (stringify on write, parse on read).
import { graphql, createItem, updateObject, deleteItem, getItem, resolveTypeId, ROOT_ID, OWNER } from "../../lib/kanectaClient.js";
import { coerceRow, selectionFor } from "../../lib/kanectaMap.js";

const SUB = [["id", "id"], ["subscription", "json"]];

// push_subscriptions / fcm_tokens carried a serial bigint PK in the source, mapped
// to a REQUIRED `id` data column (distinct from the item's UUID). GraphQL can't
// read it, so on create we mint a fresh unique bigint and on update we re-read the
// existing payload (GET /items/:id exposes it) to resend the unchanged column.
let _idSeq = 0;
function nextBigintId() { return Date.now() * 1000 + (_idSeq++ % 1000); }

// Fetch the push_subscriptions items for a user, with the raw endpoint pulled out
// for idempotency matching (subscription is stored JSON-encoded).
async function subsForUser(userId) {
  const data = await graphql(
    `query($u:String){ pushSubscriptionses(where:{userId:{eq:$u}}, limit:500){ id subscription } }`,
    { u: userId },
  );
  return data.pushSubscriptionses.map((r) => ({
    id: r.id,
    subscription: typeof r.subscription === "string" ? JSON.parse(r.subscription) : r.subscription,
  }));
}

// pg: INSERT ... ON CONFLICT (user_id, subscription->>'endpoint') DO UPDATE SET
//     subscription = EXCLUDED.subscription
export async function upsertPushSubscription(userId, subscription) {
  const endpoint = subscription?.endpoint;
  const existing = (await subsForUser(userId)).find((s) => s.subscription?.endpoint === endpoint);
  const payload = JSON.stringify(subscription);
  if (existing) {
    // Resend the whole existing payload (incl. the required bigint id) with the
    // new subscription — writeObjectJson validates against the full schema.
    const prev = (await getItem(existing.id))?.payload ?? {};
    await updateObject(existing.id, { ...prev, userId, subscription: payload });
    return;
  }
  const typeId = await resolveTypeId("push-subscriptions");
  await createItem({
    type: "object", typeId, parentId: ROOT_ID, owner: OWNER,
    objectData: { id: nextBigintId(), userId, subscription: payload, createdAt: new Date().toISOString() },
  });
}

// pg: DELETE FROM push_subscriptions WHERE user_id=$1 AND subscription->>'endpoint'=$2
export async function deletePushSubscription(userId, endpoint) {
  const matches = (await subsForUser(userId)).filter((s) => s.subscription?.endpoint === endpoint);
  for (const m of matches) await deleteItem(m.id, { force: true });
}

// pg: SELECT id, subscription FROM push_subscriptions WHERE user_id=$1
export async function getUserSubscriptions(userId) {
  const data = await graphql(
    `query($u:String){ pushSubscriptionses(where:{userId:{eq:$u}}, limit:500){ ${selectionFor(SUB)} } }`,
    { u: userId },
  );
  return data.pushSubscriptionses.map((r) => coerceRow(r, SUB));
}

// pg: SELECT DISTINCT ps.user_id, ps.id, ps.subscription
//     FROM thread_notification_subscriptions tns
//     JOIN push_subscriptions ps ON ps.user_id = tns.user_id
//     WHERE tns.thread_id=$1 AND tns.user_id != $2
export async function getThreadSubscribers(threadId, authorUserId) {
  const data = await graphql(
    `query($t:ID){ threadNotificationSubscriptionses(where:{threadId:{eq:$t}}, limit:500){ userId } }`,
    { t: threadId },
  );
  const userIds = [...new Set(
    data.threadNotificationSubscriptionses.map((r) => r.userId?.id ?? r.userId).filter((u) => u && u !== authorUserId),
  )];
  const out = [];
  for (const uid of userIds) {
    const subs = await graphql(
      `query($u:String){ pushSubscriptionses(where:{userId:{eq:$u}}, limit:500){ id subscription userId } }`,
      { u: uid },
    );
    for (const s of subs.pushSubscriptionses) {
      out.push({
        user_id: s.userId?.id ?? s.userId ?? uid,
        id: s.id,
        subscription: typeof s.subscription === "string" ? JSON.parse(s.subscription) : s.subscription,
      });
    }
  }
  return out;
}

// pg: DELETE FROM push_subscriptions WHERE id=$1
export async function deleteSubscriptionById(id) {
  await deleteItem(id, { force: true });
}

// Fetch a user's fcm_tokens items (id + token) for idempotency matching.
async function tokensForUser(userId) {
  const data = await graphql(
    `query($u:String){ fcmTokenses(where:{userId:{eq:$u}}, limit:500){ id token } }`, { u: userId },
  );
  return data.fcmTokenses;
}

// pg: INSERT ... ON CONFLICT (user_id, token) DO NOTHING
export async function upsertFcmToken(userId, token) {
  const existing = (await tokensForUser(userId)).find((t) => t.token === token);
  if (existing) return;
  const typeId = await resolveTypeId("fcm-tokens");
  await createItem({
    type: "object", typeId, parentId: ROOT_ID, owner: OWNER,
    objectData: { id: nextBigintId(), userId, token, createdAt: new Date().toISOString() },
  });
}

// pg: DELETE FROM fcm_tokens WHERE user_id=$1 AND token=$2
export async function deleteFcmToken(userId, token) {
  const matches = (await tokensForUser(userId)).filter((t) => t.token === token);
  for (const m of matches) await deleteItem(m.id, { force: true });
}

// pg: SELECT category, enabled FROM notification_preferences WHERE user_id=$1
export async function getPreferences(userId) {
  const data = await graphql(
    `query($u:String){ notificationPreferenceses(where:{userId:{eq:$u}}, limit:500){ category enabled } }`,
    { u: userId },
  );
  return data.notificationPreferenceses.map((r) => ({ category: r.category, enabled: r.enabled }));
}

// pg: INSERT ... ON CONFLICT (user_id, category) DO UPDATE SET enabled = EXCLUDED.enabled
export async function upsertPreference(userId, category, enabled) {
  const data = await graphql(
    `query($u:String){ notificationPreferenceses(where:{userId:{eq:$u}}, limit:500){ id category } }`,
    { u: userId },
  );
  const existing = data.notificationPreferenceses.find((p) => p.category === category);
  if (existing) {
    await updateObject(existing.id, { userId, category, enabled: !!enabled });
    return;
  }
  const typeId = await resolveTypeId("notification-preferences");
  await createItem({
    type: "object", typeId, parentId: ROOT_ID, owner: OWNER,
    objectData: { userId, category, enabled: !!enabled },
  });
}
