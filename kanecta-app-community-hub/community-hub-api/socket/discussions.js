import jwt from "jsonwebtoken";
import jwksClient from "jwks-rsa";

const KEYCLOAK_URL = process.env.KEYCLOAK_URL || "https://auth.featherston.co.nz";
const REALM = process.env.KEYCLOAK_REALM || "featherston";
const ISSUER = `${KEYCLOAK_URL}/realms/${REALM}`;

const client = jwksClient({
  jwksUri: `${ISSUER}/protocol/openid-connect/certs`,
  cache: true,
  cacheMaxAge: 10 * 60 * 1000,
});

function getKey(header, callback) {
  client.getSigningKey(header.kid, (err, key) => {
    if (err) return callback(err);
    callback(null, key.getPublicKey());
  });
}

export function setupDiscussionsSocket(io) {
  // Auth middleware on every socket connection
  io.use((socket, next) => {
    const token = socket.handshake.auth?.token;
    if (!token) return next(new Error("Missing token"));

    jwt.verify(token, getKey, { issuer: ISSUER }, (err, decoded) => {
      if (err) return next(new Error("Invalid token"));
      const roles = decoded.realm_access?.roles || [];
      if (!roles.includes("team") && !roles.includes("moderator")) {
        return next(new Error("Insufficient role"));
      }
      socket.user = {
        id: decoded.sub,
        name: [decoded.given_name, decoded.family_name].filter(Boolean).join(" ") || decoded.preferred_username,
        roles,
      };
      next();
    });
  });

  io.on("connection", (socket) => {
    // Client joins a thread room to receive messages
    socket.on("thread:join", (threadId) => {
      socket.join(`thread:${threadId}`);
    });

    socket.on("thread:leave", (threadId) => {
      socket.leave(`thread:${threadId}`);
    });

    // Client joins a reply panel room
    socket.on("replies:join", (messageId) => {
      socket.join(`replies:${messageId}`);
    });

    socket.on("replies:leave", (messageId) => {
      socket.leave(`replies:${messageId}`);
    });
  });
}
