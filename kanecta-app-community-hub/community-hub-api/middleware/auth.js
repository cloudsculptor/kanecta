import jwt from "jsonwebtoken";
import jwksClient from "jwks-rsa";

const KEYCLOAK_URL = process.env.KEYCLOAK_URL || "https://auth.featherston.co.nz";
const REALM = process.env.KEYCLOAK_REALM || "featherston";
const ISSUER = `${KEYCLOAK_URL}/realms/${REALM}`;

const client = jwksClient({
  jwksUri: `${ISSUER}/protocol/openid-connect/certs`,
  cache: true,
  cacheMaxEntries: 5,
  cacheMaxAge: 10 * 60 * 1000,
});

function getKey(header, callback) {
  client.getSigningKey(header.kid, (err, key) => {
    if (err) return callback(err);
    callback(null, key.getPublicKey());
  });
}

export function requireAuth(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith("Bearer ")) {
    return res.status(401).json({ error: "Missing token" });
  }

  const token = authHeader.slice(7);
  jwt.verify(token, getKey, { issuer: ISSUER }, (err, decoded) => {
    if (err) return res.status(401).json({ error: "Invalid token" });
    req.user = {
      id: decoded.sub,
      name: [decoded.given_name, decoded.family_name].filter(Boolean).join(" ") || decoded.preferred_username,
      roles: decoded.realm_access?.roles || [],
    };
    next();
  });
}

export function requireRole(...roles) {
  return (req, res, next) => {
    const hasRole = roles.some((r) => req.user?.roles.includes(r));
    if (!hasRole) return res.status(403).json({ error: "Insufficient role" });
    next();
  };
}
