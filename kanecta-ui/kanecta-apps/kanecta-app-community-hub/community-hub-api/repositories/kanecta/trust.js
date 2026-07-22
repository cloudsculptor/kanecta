// KanectaRepository — trust reads/writes over kanecta-api. Trust items back the
// endorsement chain (who vouched for whom when a team role is granted). No
// soft-delete or archive here — plain create + point reads.
import { graphql, createItem, resolveTypeId, ROOT_ID, OWNER } from "../../lib/kanectaClient.js";
import { coerceRow, selectionFor } from "../../lib/kanectaMap.js";

// The endorsement projection getEndorsementFor returns (pg column order).
const ENDORSEMENT = [
  ["endorsed_by_id", "text"], ["know_personally", "bool"], ["trusted_by_someone", "bool"],
  ["resilience_hui", "bool"], ["other_reason", "text"],
];

// pg: SELECT endorsed_by_id, know_personally, trusted_by_someone, resilience_hui,
//     other_reason FROM trust WHERE user_id=$1 ORDER BY created_at ASC LIMIT 1
export async function getEndorsementFor(userId) {
  const data = await graphql(
    `query($u:String){ trusts(where:{userId:{eq:$u}}, sort:[{field:createdAt,direction:ASC}],
        limit:1){ ${selectionFor(ENDORSEMENT)} } }`,
    { u: userId },
  );
  return data.trusts[0] ? coerceRow(data.trusts[0], ENDORSEMENT) : null;
}

// pg: SELECT id FROM trust WHERE user_id=$1 LIMIT 1 → boolean
export async function isEndorsed(userId) {
  const data = await graphql(
    `query($u:String){ trusts(where:{userId:{eq:$u}}, limit:1){ id } }`, { u: userId },
  );
  return data.trusts.length > 0;
}

// pg: INSERT INTO trust (user_id, endorsed_by_id, know_personally, trusted_by_someone,
//     resilience_hui, other_reason, locality) VALUES (...). created_at defaults to
//     NOW() in pg; set it here.
export async function createEndorsement({
  userId, endorsedById, knowPersonally, trustedBySomeone, resilienceHui, otherReason, locality,
}) {
  const typeId = await resolveTypeId("trust");
  await createItem({
    type: "object", typeId, parentId: ROOT_ID, owner: OWNER,
    objectData: {
      userId, endorsedById, knowPersonally: !!knowPersonally, trustedBySomeone: !!trustedBySomeone,
      resilienceHui: !!resilienceHui, otherReason: otherReason || null, locality: locality || null,
      createdAt: new Date().toISOString(),
    },
  });
}
