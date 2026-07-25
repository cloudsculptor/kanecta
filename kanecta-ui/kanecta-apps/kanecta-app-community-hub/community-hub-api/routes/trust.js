import { Router } from "express";
import { requireAuth } from "../middleware/auth.js";
import { adminFetch } from "../lib/keycloakAdmin.js";
import { getEndorsementFor, isEndorsed } from "../repositories/trust.js";

const router = Router();
const wrap = fn => (req, res, next) => fn(req, res, next).catch(next);

async function resolveNames(ids) {
  const nameMap = {};
  await Promise.all(ids.map(async (id) => {
    try {
      const user = await adminFetch(`/users/${id}`);
      nameMap[id] = [user.firstName, user.lastName].filter(Boolean).join(" ") || user.username || null;
    } catch {
      nameMap[id] = null;
    }
  }));
  return nameMap;
}

function buildReasonLabel({ know_personally, trusted_by_someone, resilience_hui, other_reason }) {
  const parts = [];
  if (know_personally) parts.push("knows them personally");
  if (trusted_by_someone) parts.push("someone they trust knows them");
  if (resilience_hui) parts.push("came to a Resilience Hui");
  if (other_reason) parts.push(other_reason);
  return parts.join(", ") || null;
}

// GET /api/trust/my-chain
// Returns the chain of trust nodes from the root (Administrator) down to the current user.
// Each node except the first includes the reason given when they were trusted.
router.get("/my-chain", requireAuth, wrap(async (req, res) => {
  // Walk up the chain collecting [userId, trustRecord] pairs
  const steps = []; // each: { userId, trustRecord | null }
  let currentId = req.user.id;
  const visited = new Set();
  const MAX_DEPTH = 20;

  while (currentId && !visited.has(currentId) && steps.length < MAX_DEPTH) {
    visited.add(currentId);

    const trustRecord = await getEndorsementFor(currentId);

    steps.unshift({ userId: currentId, trustRecord });

    if (!trustRecord) break; // no trust record — this is the root

    const endorserId = trustRecord.endorsed_by_id;
    if (visited.has(endorserId)) break;

    // Check if endorser was themselves trusted; if not they're the root (Administrator)
    if (!(await isEndorsed(endorserId))) {
      steps.unshift({ userId: endorserId, trustRecord: null });
      break;
    }

    currentId = endorserId;
  }

  const uniqueIds = [...new Set(steps.map(s => s.userId))];
  const nameMap = await resolveNames(uniqueIds);

  const nodes = steps.map(({ userId, trustRecord }, index) => {
    const isFirst = index === 0;
    const isLast = index === steps.length - 1;
    return {
      id: userId,
      name: isFirst && !steps[0].trustRecord ? "Administrator" : (nameMap[userId] ?? "Unknown"),
      isCurrentUser: isLast,
      trustedBy: trustRecord
        ? {
            endorserId: trustRecord.endorsed_by_id,
            reason: buildReasonLabel(trustRecord),
          }
        : null,
    };
  });

  res.json(nodes);
}));

export default router;
