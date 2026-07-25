// Local stand-in for Keycloak, for end-to-end testing only. Generates an RS256
// keypair, serves the matching JWKS at the realm certs URL that middleware/auth.js
// fetches, mints a signed token (team+moderator, email verified), and writes it to
// a file for the curl step. Boot community-hub-api with:
//   KEYCLOAK_URL=http://127.0.0.1:45571 KEYCLOAK_REALM=featherston
// so requireAuth verifies real signatures against this JWKS.
import http from "http";
import fs from "fs";
import { generateKeyPairSync } from "crypto";
import jwt from "jsonwebtoken";

const PORT = 45571;
const REALM = "featherston";
const ISSUER = `http://127.0.0.1:${PORT}/realms/${REALM}`;
const KID = "e2e-test-key";
const TOKEN_FILE = process.env.E2E_TOKEN_FILE || "/tmp/e2e-token.txt";
// A real community-hub user id from the backfilled data (has thread reads + subs).
const USER = process.env.E2E_USER || "111f6452-1c13-4251-b937-4c7696906d50";

const { publicKey, privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
const jwk = { ...publicKey.export({ format: "jwk" }), kid: KID, use: "sig", alg: "RS256" };

const token = jwt.sign(
  {
    sub: USER, given_name: "Richard", family_name: "Thomas",
    preferred_username: "richard", email_verified: true,
    realm_access: { roles: ["team", "moderator"] },
  },
  privateKey.export({ format: "pem", type: "pkcs8" }),
  { algorithm: "RS256", keyid: KID, issuer: ISSUER, expiresIn: "1h" },
);
fs.writeFileSync(TOKEN_FILE, token);

http.createServer((req, res) => {
  if (req.url === `/realms/${REALM}/protocol/openid-connect/certs`) {
    res.setHeader("content-type", "application/json");
    return res.end(JSON.stringify({ keys: [jwk] }));
  }
  res.statusCode = 404;
  res.end("not found");
}).listen(PORT, "127.0.0.1", () => {
  console.log(`e2e JWKS server on ${ISSUER}; token → ${TOKEN_FILE}`);
});
