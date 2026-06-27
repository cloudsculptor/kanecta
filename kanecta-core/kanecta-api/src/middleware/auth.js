'use strict';

const jwt = require('jsonwebtoken');
const jwksClient = require('jwks-rsa');

// Kanecta is installed into client systems that bring their own Keycloak —
// there is no default realm to fall back to, every deployment must supply
// KEYCLOAK_URL and KEYCLOAK_REALM explicitly.
let _client = null;
let _issuer = null;

function getJwksClient() {
  const KEYCLOAK_URL = process.env.KEYCLOAK_URL;
  const REALM = process.env.KEYCLOAK_REALM;
  if (!KEYCLOAK_URL || !REALM) {
    throw new Error('KEYCLOAK_URL and KEYCLOAK_REALM must be set (or AUTH_DISABLED=true for local dev)');
  }

  const issuer = `${KEYCLOAK_URL}/realms/${REALM}`;
  if (!_client || _issuer !== issuer) {
    _issuer = issuer;
    _client = jwksClient({
      jwksUri: `${issuer}/protocol/openid-connect/certs`,
      cache: true,
      cacheMaxEntries: 5,
      cacheMaxAge: 10 * 60 * 1000,
    });
  }
  return { client: _client, issuer: _issuer };
}

function getKey(client) {
  return (header, callback) => {
    client.getSigningKey(header.kid, (err, key) => {
      if (err) return callback(err);
      callback(null, key.getPublicKey());
    });
  };
}

function requireAuth(req, res, next) {
  if (process.env.AUTH_DISABLED === 'true') {
    req.user = { id: 'local-dev', name: 'Local Dev', roles: ['admin'], email_verified: true };
    return next();
  }

  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Missing token' });
  }

  let client, issuer;
  try {
    ({ client, issuer } = getJwksClient());
  } catch (err) {
    return res.status(503).json({ error: err.message });
  }

  const token = authHeader.slice(7);
  jwt.verify(token, getKey(client), { issuer }, (err, decoded) => {
    if (err) return res.status(401).json({ error: 'Invalid token' });
    req.user = {
      id: decoded.sub,
      name: [decoded.given_name, decoded.family_name].filter(Boolean).join(' ') || decoded.preferred_username,
      roles: decoded.realm_access?.roles || [],
      email_verified: decoded.email_verified === true,
    };
    next();
  });
}

function requireRole(...roles) {
  return (req, res, next) => {
    const hasRole = roles.some((r) => req.user?.roles.includes(r));
    if (!hasRole) return res.status(403).json({ error: 'Insufficient role' });
    next();
  };
}

module.exports = { requireAuth, requireRole };
