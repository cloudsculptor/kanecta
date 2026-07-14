// KanectaRepository — discussions reads over kanecta-api (GraphQL). listThreads is
// the "harder residue" of Phase B: a per-user LEFT JOIN of three tables computing
// has_unread + is_notifications_enabled. GraphQL has no cross-type join, so we read
// the three projected obj_ tables and join in JS — reproducing the exact CASE
// semantics and the sortOrder-NULLS-LAST ordering.
import { graphql } from "../../lib/kanectaClient.js";

// pg (see repositories/pg/discussions.js listThreads):
//   threads LEFT JOIN thread_reads(user) LEFT JOIN subscriptions(user)
//   has_unread = latest_message_at IS NOT NULL AND (last_read_at IS NULL OR latest > last_read_at)
//   is_notifications_enabled = the user has a subscription row
//   WHERE archived_at IS NULL ORDER BY sort_order ASC NULLS LAST, name ASC
export async function listThreads(userId) {
  const data = await graphql(
    `query($u:String){
       discussionsThreadses(where:{archivedAt:{isNull:true}},
         sort:[{field:sortOrder,direction:ASC,nulls:LAST},{field:name,direction:ASC}], limit:500){
         id name description createdByName createdByUserId createdAt latestMessageAt }
       discussionsThreadReadses(where:{userId:{eq:$u}}, limit:500){ threadId { id } lastReadAt }
       threadNotificationSubscriptionses(where:{userId:{eq:$u}}, limit:500){ threadId { id } }
     }`,
    { u: userId },
  );

  const lastReadByThread = new Map(
    data.discussionsThreadReadses.map((r) => [r.threadId?.id, r.lastReadAt]),
  );
  const subscribed = new Set(
    data.threadNotificationSubscriptionses.map((s) => s.threadId?.id),
  );

  return data.discussionsThreadses.map((t) => {
    const lastRead = lastReadByThread.has(t.id) ? lastReadByThread.get(t.id) : null;
    const hasUnread =
      t.latestMessageAt != null &&
      (lastRead == null || new Date(t.latestMessageAt) > new Date(lastRead));
    return {
      id: t.id,
      name: t.name,
      description: t.description,
      created_by_name: t.createdByName,
      created_by_user_id: t.createdByUserId,
      created_at: t.createdAt == null ? t.createdAt : new Date(t.createdAt).toISOString(),
      has_unread: hasUnread,
      is_notifications_enabled: subscribed.has(t.id),
    };
  });
}
