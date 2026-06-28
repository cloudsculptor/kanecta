import { Router } from "express";
import { requireAuth, requireRole } from "../middleware/auth.js";
import { adminFetch } from "../lib/keycloakAdmin.js";
import pool from "../db.js";

const router = Router();

const wrap = fn => (req, res, next) => fn(req, res, next).catch(next);

const REALM = process.env.KEYCLOAK_REALM || "featherston";
const SYSTEM_ROLES = new Set([
  "offline_access",
  "uma_authorization",
  `default-roles-${REALM}`,
]);

const APP_ROLES = ["admin", "team", "moderator", "treasurer", "resilience", "tester"];

const requireAdmin = requireRole("admin");
const requireModeratorOrAdmin = requireRole("moderator", "admin");

async function fetchUserWithRoles(user) {
  const roleMappings = await adminFetch(`/users/${user.id}/role-mappings/realm/composite`);
  const roles = roleMappings.map(r => r.name).filter(name => APP_ROLES.includes(name));
  return {
    id: user.id,
    name: [user.firstName, user.lastName].filter(Boolean).join(" ") || user.username,
    email: user.email || "",
    username: user.username,
    roles,
    enabled: user.enabled,
    createdTimestamp: user.createdTimestamp,
  };
}

// GET /api/members — admin only, all users with emails
router.get("/", requireAuth, requireAdmin, wrap(async (req, res) => {
  const users = await adminFetch("/users?max=1000&briefRepresentation=false");
  const members = await Promise.all(users.map(fetchUserWithRoles));
  res.json(members);
}));

// GET /api/members/pending — moderator+admin, no-role users, includes email
router.get("/pending", requireAuth, requireModeratorOrAdmin, wrap(async (req, res) => {
  const users = await adminFetch("/users?max=1000&briefRepresentation=false");
  const members = await Promise.all(users.map(fetchUserWithRoles));
  res.json(members.filter(m => m.roles.length === 0));
}));

// GET /api/members/active — moderator+admin, users with roles; email included for admins only
router.get("/active", requireAuth, requireModeratorOrAdmin, wrap(async (req, res) => {
  const isAdmin = req.user.roles?.includes("admin");
  const users = await adminFetch("/users?max=1000&briefRepresentation=false");
  const members = await Promise.all(users.map(fetchUserWithRoles));
  const active = members.filter(m => m.roles.length > 0);
  res.json(isAdmin ? active : active.map(({ email: _email, ...rest }) => rest));
}));

// POST /api/members/:userId/roles/team — moderator+admin, assigns team role and saves trust record
router.post("/:userId/roles/team", requireAuth, requireModeratorOrAdmin, wrap(async (req, res) => {
  const { userId } = req.params;
  const { know_personally, trusted_by_someone, resilience_hui, other_reason, locality } = req.body;

  if (!locality || !["local", "supporter"].includes(locality)) {
    return res.status(400).json({ error: "locality must be 'local' or 'supporter'" });
  }
  if (!know_personally && !trusted_by_someone && !resilience_hui && !other_reason?.trim()) {
    return res.status(400).json({ error: "At least one trust reason is required" });
  }

  const available = await adminFetch(`/users/${userId}/role-mappings/realm/available`);
  const teamRole = available.find(r => r.name === "team");
  if (!teamRole) {
    return res.status(400).json({ error: "Team role already assigned or does not exist" });
  }

  await adminFetch(`/users/${userId}/role-mappings/realm`, {
    method: "POST",
    body: JSON.stringify([teamRole]),
  });

  await pool.query(
    `INSERT INTO trust (user_id, endorsed_by_id, know_personally, trusted_by_someone, resilience_hui, other_reason, locality)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [userId, req.user.id, !!know_personally, !!trusted_by_someone, !!resilience_hui, other_reason?.trim() || null, locality]
  );

  res.status(204).end();
}));

export default router;
