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

  // Sort: by creation time ascending
  members.sort((a, b) => a.createdTimestamp - b.createdTimestamp);

  res.json(members);
}));

// POST /api/members/:userId/roles/team — assign the team role to a user
router.post("/:userId/roles/team", requireAuth, requireAdmin, wrap(async (req, res) => {
  const { userId } = req.params;

  // Validate the user exists
  await adminFetch(`/users/${userId}`);

  // Fetch the team role representation (we need the role id)
  const teamRole = await adminFetch("/roles/team");

  await adminFetch(`/users/${userId}/role-mappings/realm`, {
    method: "POST",
    body: JSON.stringify([{ id: teamRole.id, name: teamRole.name }]),
  });

  res.status(204).end();
}));

export default router;
