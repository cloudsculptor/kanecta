import { Router } from "express";
import { requireAuth, requireRole } from "../middleware/auth.js";
import { adminFetch } from "../lib/keycloakAdmin.js";

const router = Router();

const wrap = fn => (req, res, next) => fn(req, res, next).catch(next);

const REALM = process.env.KEYCLOAK_REALM || "featherston";
const SYSTEM_ROLES = new Set([
  "offline_access",
  "uma_authorization",
  `default-roles-${REALM}`,
]);

const APP_ROLES = ["admin", "team", "moderator", "treasurer", "resilience"];

const requireAdmin = requireRole("admin");

// GET /api/members — list all realm users with their app roles
router.get("/", requireAuth, requireAdmin, wrap(async (req, res) => {
  const users = await adminFetch("/users?max=1000&briefRepresentation=false");

  const members = await Promise.all(
    users.map(async (user) => {
      const roleMappings = await adminFetch(`/users/${user.id}/role-mappings/realm/composite`);
      const roles = roleMappings
        .map(r => r.name)
        .filter(name => APP_ROLES.includes(name));

      return {
        id: user.id,
        name: [user.firstName, user.lastName].filter(Boolean).join(" ") || user.username,
        email: user.email || "",
        username: user.username,
        roles,
        enabled: user.enabled,
        createdTimestamp: user.createdTimestamp,
      };
    })
  );

  res.json(members);
}));

// POST /api/members/:userId/roles/team — assign the team realm role directly
router.post("/:userId/roles/team", requireAuth, requireAdmin, wrap(async (req, res) => {
  const { userId } = req.params;

  // Get roles available to assign (requires manage-users, not view-realm)
  const available = await adminFetch(`/users/${userId}/role-mappings/realm/available`);
  const teamRole = available.find(r => r.name === "team");
  if (!teamRole) {
    return res.status(400).json({ error: "Team role already assigned or does not exist" });
  }

  await adminFetch(`/users/${userId}/role-mappings/realm`, {
    method: "POST",
    body: JSON.stringify([teamRole]),
  });

  res.status(204).end();
}));

export default router;
